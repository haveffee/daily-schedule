const test = require('node:test');
const assert = require('node:assert/strict');
const backend = import('../backend/app/worker.mjs');
const APP = 'https://hvf-app.example';
const AUTH = 'https://daily-schedule-sync-fc374.firebaseapp.com';

async function fixture({ upstream } = {}) {
  const { createApp } = await backend;
  const assets = [], billing = [], forwarded = [];
  const env = { BILLING_MODE: 'disabled', privateMarker: Symbol('env'), ASSETS: { async fetch(request) { assets.push(request); return new Response('public asset', { headers: { 'Content-Type': 'text/html' } }); } } };
  const worker = createApp({ billingHandler: { async fetch(request, receivedEnv) { billing.push({ request, env: receivedEnv }); return Response.json({ delegated: true }, { headers: { 'Cache-Control': 'no-store' } }); } }, fetcher: async (url, options) => {
    forwarded.push({ url, options });
    return upstream ? upstream(url, options) : new Response('firebase helper', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public,max-age=1000' } });
  } });
  const call = (route, options = {}) => worker.fetch(new Request(APP + route, options), env);
  return { worker, env, call, assets, billing, forwarded };
}

test('ordinary app files use static assets binding without billing or auth proxy requests', async () => {
  const f = await fixture();
  for (const route of ['/', '/assistant-ui.js?v=14', '/icons/icon-192.png']) assert.equal(await (await f.call(route)).text(), 'public asset');
  assert.deepEqual(f.assets.map(request => new URL(request.url).pathname), ['/index.html', '/assistant-ui.js', '/icons/icon-192.png']);
  assert.equal(f.billing.length, 0); assert.equal(f.forwarded.length, 0);
});

test('billing requests are delegated once with original bearer/body/env and never reach static hosting', async () => {
  const f = await fixture();
  const result = await f.call('/api/billing/checkout', { method: 'POST', headers: { Authorization: 'Bearer private-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'monthly' }) });
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { delegated: true });
  assert.equal(f.billing.length, 1); assert.equal(f.billing[0].env, f.env);
  assert.equal(f.billing[0].request.headers.get('Authorization'), 'Bearer private-token');
  assert.deepEqual(await f.billing[0].request.json(), { plan: 'monthly' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.assets.length, 0); assert.equal(f.forwarded.length, 0);
});

test('unknown API routes return JSON 404 and cannot become an HTML SPA success response', async () => {
  const f = await fixture();
  for (const route of ['/api/private', '/api/billing', '/api/accounts?token=secret']) {
    const result = await f.call(route); assert.equal(result.status, 404);
    assert.match(result.headers.get('Content-Type'), /application\/json/); assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal((await result.json()).error.code, 'not_found');
  }
  assert.equal(f.assets.length, 0); assert.equal(f.forwarded.length, 0);
});

test('health is uncached and reports disabled payments without exposing environment values', async () => {
  const f = await fixture(); const result = await f.call('/health');
  assert.deepEqual(await result.json(), { ok: true, app: 'HVF', payments: 'disabled' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.assets.length + f.billing.length + f.forwarded.length, 0);
});

test('Firebase helper proxy has a fixed target and does not forward session or authorization secrets', async () => {
  const f = await fixture();
  const query = '?apiKey=public-key&redirectUrl=https%3A%2F%2Fevil.example%2F&target=https%3A%2F%2Fevil.example';
  const result = await f.call('/__/auth/handler' + query, { headers: {
    Cookie: 'private-session=secret', Authorization: 'Bearer private-account-token', Host: 'attacker.example', Accept: 'text/html',
    'Accept-Language': 'ru', 'X-HTTP-Method-Override': 'DELETE', 'X-Private-User': 'private-alice'
  } });
  assert.equal(result.status, 200); assert.equal(f.forwarded.length, 1);
  const call = f.forwarded[0], headers = new Headers(call.options.headers);
  assert.equal(call.url, AUTH + '/__/auth/handler' + query);
  assert.equal(call.options.redirect, 'manual'); assert.equal(call.options.method, 'GET'); assert.equal(call.options.body, undefined);
  for (const name of ['cookie', 'authorization', 'host', 'x-http-method-override', 'x-private-user']) assert.equal(headers.has(name), false, name + ' must not cross the Firebase boundary');
  assert.equal(headers.get('Accept'), 'text/html');
  assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.equal(f.assets.length, 0);
});

test('proxy forwards POST OAuth body unchanged, blocks other methods and rewrites only Firebase redirects', async () => {
  const f = await fixture({ upstream: async () => new Response(null, { status: 302, headers: { Location: AUTH + '/__/auth/iframe?key=public#done', 'Cache-Control': 'public' } }) });
  const body = 'credential=oauth-value&target=https%3A%2F%2Fevil.example';
  const result = await f.call('/__/auth/handler?state=opaque', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(f.forwarded[0].url, AUTH + '/__/auth/handler?state=opaque');
  assert.equal(f.forwarded[0].options.method, 'POST'); assert.equal(await new Response(f.forwarded[0].options.body).text(), body);
  assert.equal(new Headers(f.forwarded[0].options.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
  assert.equal(result.status, 302); assert.equal(result.headers.get('Location'), APP + '/__/auth/iframe?key=public#done');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal((await f.call('/__/auth/handler', { method: 'DELETE' })).status, 405); assert.equal(f.forwarded.length, 1);
  const external = await fixture({ upstream: async () => new Response(null, { status: 302, headers: { Location: 'https://accounts.google.com/o/oauth2/auth?state=opaque' } }) });
  const redirected = await external.call('/__/auth/handler');
  assert.equal(redirected.headers.get('Location'), 'https://accounts.google.com/o/oauth2/auth?state=opaque');
});
