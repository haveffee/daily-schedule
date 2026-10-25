const test = require('node:test');
const assert = require('node:assert/strict');
const billing = require('../assistant-billing.js');

const catalog = (ready = false) => ({ mode: ready ? 'live' : 'disabled', paymentsReady: ready, currency: 'BYN', plans: billing.plans.map(plan => ({ ...plan })) });
const account = (plus = false) => ({ mode: 'live', paymentsReady: true, plan: plus ? 'plus' : 'free', status: plus ? 'active' : 'free', billingPlan: plus ? 'monthly' : null, periodEnd: plus ? '2026-11-25T12:00:00Z' : null, renewAt: null, cancelAtPeriodEnd: false });
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function fixture(handler, getToken) {
  const calls = []; let tokens = 0;
  const client = billing.create({ getToken: async () => { tokens++; return getToken ? getToken() : 'private-id-token'; }, fetch: async (url, options) => {
    calls.push({ url, options });
    if (handler) return handler(url, options, calls);
    return Response.json(url.endsWith('/catalog') ? catalog() : account());
  } });
  return { client, calls, tokens: () => tokens };
}

test('anonymous beta refresh is public, approved prices remain exact, and no checkout can start', async () => {
  const f = fixture();
  assert.equal(await f.client.refresh(), true);
  assert.equal(f.tokens(), 0); assert.deepEqual(f.calls.map(call => call.url), ['/api/billing/catalog']);
  const state = f.client.getState(); assert.equal(state.account, null); assert.equal(state.catalog.paymentsReady, false);
  assert.deepEqual(state.plans.map(({ id, amount, currency, interval }) => ({ id, amount, currency, interval })), [
    { id: 'monthly', amount: 800, currency: 'BYN', interval: 'month' }, { id: 'yearly', amount: 7200, currency: 'BYN', interval: 'year' }
  ]);
  assert.equal(1 - state.plans[1].amount / (state.plans[0].amount * 12), .25, 'yearly offer saves exactly 25%');
  await assert.rejects(() => f.client.checkout('monthly'), /не подключена|бете/);
  await assert.rejects(() => f.client.cancel(), /пока нет/);
  assert.equal(f.calls.length, 1); assert.equal(f.tokens(), 0);
});

test('authenticated requests use header tokens and omit cookies; catalogue never needs a token', async () => {
  const f = fixture((url) => Response.json(url.endsWith('/catalog') ? catalog(true) : url.endsWith('/checkout') ? { checkoutUrl: 'https://checkout.bepaid.by/v2/checkout?token=provider-token', orderId: 'server-order' } : account()));
  f.client.setUser({ uid: 'alice', email: 'not-sent@example.com' });
  await f.client.refresh();
  assert.equal(await f.client.checkout('monthly'), 'https://checkout.bepaid.by/v2/checkout?token=provider-token');
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
  const status = f.calls.find(call => call.url.endsWith('/status'));
  assert.equal(status.options.headers.Authorization, 'Bearer private-id-token');
  const checkout = f.calls.find(call => call.url.endsWith('/checkout'));
  assert.deepEqual(JSON.parse(checkout.options.body), { plan: 'monthly' });
  for (const call of f.calls) {
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.redirect, 'error');
    assert.doesNotMatch(call.url, /private-id-token|alice|not-sent/);
    assert.doesNotMatch(call.options.body || '', /private-id-token|alice|not-sent|amount|currency/);
  }
});

test('wrong catalogue currency, price, interval and readiness are rejected before payment', async () => {
  for (const change of [
    value => { value.plans[0].amount = 1; }, value => { value.plans[1].currency = 'USD'; },
    value => { value.plans[1].interval = 'month'; }, value => { value.mode = 'disabled'; value.paymentsReady = true; },
    value => { value.plans = [value.plans[0], value.plans[0]]; }
  ]) {
    const wrong = catalog(true); change(wrong);
    const f = fixture(() => Response.json(wrong));
    assert.equal(await f.client.refresh(), false);
    assert.equal(f.client.getState().catalog, null); assert.ok(f.client.getState().error);
    await assert.rejects(() => f.client.checkout('monthly'));
    assert.equal(f.calls.length, 1);
  }
});

test('changing account discards stale entitlement responses and immediately removes former Plus', async () => {
  const waiting = deferred(), started = deferred(); let block = false;
  const f = fixture(url => {
    if (url.endsWith('/catalog')) return Response.json(catalog(true));
    if (block) { started.resolve(); return waiting.promise; }
    return Response.json(account(true));
  });
  f.client.setUser({ uid: 'alice' }); await f.client.refresh(); assert.equal(f.client.getState().account.plan, 'plus');
  block = true; const pending = f.client.refresh();
  await started.promise;
  f.client.setUser({ uid: 'bob' }); assert.equal(f.client.getState().account, null);
  waiting.resolve(Response.json(account(true))); assert.equal(await pending, false);
  assert.equal(f.client.getState().account, null); assert.equal(f.client.getState().user.uid, 'bob');
});

test('failed status, invalid account and malformed response clear previously verified Plus', async () => {
  for (const broken of [() => Response.json({ error: { message: 'Недоступно' } }, { status: 503 }), () => Response.json({ plan: 'admin', status: 'active' }), () => new Response('<html>offline</html>')]) {
    let fail = false;
    const client = billing.create({ getToken: async () => 'token', fetch: async url => url.endsWith('/catalog') ? Response.json(catalog(true)) : fail ? broken() : Response.json(account(true)) });
    client.setUser({ uid: 'alice' }); await client.refresh(); assert.equal(client.getState().account.plan, 'plus');
    fail = true; assert.equal(await client.refresh(), false);
    assert.equal(client.getState().account, null); assert.equal(client.getState().catalog, null); assert.ok(client.getState().error);
  }
});

test('checkout rejects malicious payment destinations and valid-looking origin tricks', async () => {
  for (const checkoutUrl of ['javascript:alert(1)', 'https://evil.example/v2/checkout', 'https://checkout.bepaid.by.evil.example/v2/checkout', 'https://someone:secret@checkout.bepaid.by/v2/checkout', 'https://checkout.bepaid.by/unsafe']) {
    const f = fixture(url => Response.json(url.endsWith('/catalog') ? catalog(true) : url.endsWith('/status') ? account() : { checkoutUrl }));
    f.client.setUser({ uid: 'alice' }); await f.client.refresh();
    await assert.rejects(() => f.client.checkout('monthly'), /страница/);
  }
});

test('cancel requires ready billing and authenticated user, posts no foreign account identifiers, refreshes status', async () => {
  let canceled = false;
  const f = fixture(url => {
    if (url.endsWith('/catalog')) return Response.json(catalog(true));
    if (url.endsWith('/cancel')) { canceled = true; return Response.json({ canceled: true, periodEnd: '2026-11-25T12:00:00Z' }); }
    return Response.json({ ...account(true), status: canceled ? 'canceled' : 'active', cancelAtPeriodEnd: canceled });
  });
  await f.client.refresh(); await assert.rejects(() => f.client.cancel(), /войди/);
  f.client.setUser({ uid: 'alice' }); await f.client.refresh();
  const result = await f.client.cancel(); assert.equal(result.canceled, true);
  assert.deepEqual(JSON.parse(f.calls.find(call => call.url.endsWith('/cancel')).options.body), {});
  assert.equal(f.client.getState().account.cancelAtPeriodEnd, true);
});

test('account change while obtaining token prevents checkout and cancellation before financial POST', async () => {
  for (const action of ['checkout', 'cancel']) {
    let waitToken = false; const gate = deferred();
    const f = fixture(url => Response.json(url.endsWith('/catalog') ? catalog(true) : url.endsWith('/status') ? account() : { checkoutUrl: 'https://checkout.bepaid.by/v2/checkout', canceled: true }), () => waitToken ? gate.promise : 'alice-token');
    f.client.setUser({ uid: 'alice' }); await f.client.refresh();
    waitToken = true;
    const pending = action === 'checkout' ? f.client.checkout('monthly') : f.client.cancel();
    f.client.setUser({ uid: 'bob' }); gate.resolve('bob-token');
    await assert.rejects(() => pending, /Аккаунт изменился/);
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 0, action + ' must be canceled before sending a token for another account');
  }
});

test('stale catalogue refresh does not authenticate a status request in another account scope', async () => {
  const gate = deferred();
  const f = fixture(url => url.endsWith('/catalog') ? gate.promise : Response.json(account()));
  f.client.setUser({ uid: 'alice' }); const pending = f.client.refresh();
  f.client.setUser({ uid: 'bob' }); gate.resolve(Response.json(catalog(true)));
  assert.equal(await pending, false); assert.equal(f.tokens(), 0);
  assert.deepEqual(f.calls.map(call => call.url), ['/api/billing/catalog']);
});
