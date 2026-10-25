const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const modulePromise = import('../backend/billing/worker.mjs');
const START = Date.parse('2026-10-25T12:00:00Z');
const APP = 'https://hvf-app.example';
const DAY = 86400000;

// Run the production migrations and SQL with real SQLite; adapt only D1's API.
class D1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    const directory = path.join(__dirname, '../backend/billing/migrations');
    for (const file of fs.readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) this.sqlite.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
  prepare(sql) {
    const database = this;
    function statement(values) {
      return {
        bind(...next) { return statement(next); },
        async first() { return database.sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: database.sqlite.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(database.sqlite.prepare(sql).run(...values).changes) } }; }
      };
    }
    return statement([]);
  }
  rows(table) { assert.match(table, /^billing_(orders|events)$/); return this.sqlite.prepare('SELECT * FROM ' + table).all(); }
}
const signing = (async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  return { pair, pem: '-----BEGIN PUBLIC KEY-----\n' + spki.match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----' };
})();
function plan(id = 'monthly', overrides = {}) {
  return { id: id === 'monthly' ? 'pln_monthly' : 'pln_yearly', currency: 'BYN', test: false,
    plan: { amount: id === 'monthly' ? 800 : 7200, interval: id === 'monthly' ? 1 : 12, interval_unit: 'month' }, ...overrides };
}
async function fixture({ live = false, fetcher } = {}) {
  const api = await modulePromise, db = new D1Database(), signed = await signing;
  const env = { BILLING_DB: db, APP_URL: APP + '/', BILLING_MODE: live ? 'live' : 'disabled', BILLING_MERCHANT_APPROVED: 'true', BEPAID_SHOP_ID: '1234', BEPAID_SECRET_KEY: 'test-only-secret', BEPAID_MONTHLY_PLAN_ID: 'pln_monthly', BEPAID_YEARLY_PLAN_ID: 'pln_yearly', BEPAID_WEBHOOK_PUBLIC_KEY: signed.pem };
  let clock = START, nextId = 0;
  const calls = [], providerState = new Map();
  const transport = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'manual', 'provider redirects must never be followed with merchant credentials');
    assert.equal(options.headers.Authorization, 'Basic ' + btoa('1234:test-only-secret'));
    if (fetcher) return fetcher(url, options, providerState);
    const route = new URL(url).pathname;
    if (route === '/plans/pln_monthly') return Response.json(plan());
    if (route === '/plans/pln_yearly') return Response.json(plan('yearly'));
    if (route === '/subscriptions' && options.method === 'POST') {
      const body = JSON.parse(options.body), id = 'sbs_' + body.tracking_id;
      const snapshot = { id, tracking_id: body.tracking_id, state: 'redirecting', plan: plan(body.plan.id === 'pln_yearly' ? 'yearly' : 'monthly'), active_to: null, renew_at: null, paid_billing_cycles: 0, last_transaction: null };
      providerState.set(id, snapshot);
      return Response.json({ ...snapshot, redirect_url: 'https://checkout.bepaid.by/v2/checkout?token=' + id }, { status: 201 });
    }
    const cancel = /^\/subscriptions\/(sbs_[A-Za-z0-9_-]+)\/cancel$/.exec(route);
    if (cancel) {
      const snapshot = providerState.get(cancel[1]);
      assert.equal(JSON.parse(options.body).cancel_reason, 'Customer request in HVF');
      snapshot.state = 'canceled'; snapshot.renew_at = null;
      return Response.json(snapshot);
    }
    const get = /^\/subscriptions\/(sbs_[A-Za-z0-9_-]+)$/.exec(route);
    if (get && providerState.has(get[1])) return Response.json(providerState.get(get[1]));
    return Response.json({}, { status: 404 });
  };
  const worker = api.createBilling({ fetcher: transport, now: () => clock, uuid: () => 'order_' + ++nextId, verifyToken: async token => {
    if (token === 'alice-token') return 'alice'; if (token === 'bob-token') return 'bob'; throw new Error('invalid token');
  } });
  const call = (method, route, body, who = 'alice', headers = {}) => worker.fetch(new Request(APP + route, {
    method, headers: { Origin: APP, Authorization: 'Bearer ' + who + '-token', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  async function webhook(payload, { raw, signature, auth } = {}) {
    const body = raw === undefined ? JSON.stringify(payload) : raw;
    const sig = signature === undefined ? Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signed.pair.privateKey, Buffer.from(body))).toString('base64') : signature;
    return worker.fetch(new Request(APP + '/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth === undefined ? 'Basic ' + btoa('1234:test-only-secret') : auth, 'Content-Signature': sig }, body }), env);
  }
  return { api, env, db, call, worker, calls, providerState, webhook, setTime(value) { clock = value; } };
}
async function create(f, selected = 'monthly', who = 'alice') {
  const result = await f.call('POST', '/api/billing/checkout', { plan: selected }, who);
  assert.equal(result.status, 201, JSON.stringify(await result.clone().json()));
  return result.json();
}
function pay(f, id = 'sbs_order_1', overrides = {}) {
  Object.assign(f.providerState.get(id), { state: 'active', active_to: new Date(START + 30 * DAY).toISOString(), renew_at: new Date(START + 30 * DAY).toISOString(), paid_billing_cycles: 1, last_transaction: { uid: 'tx_1', status: 'successful' }, ...overrides });
  return f.providerState.get(id);
}

test('default mode is free beta, exact approved prices, no billing writes or provider calls', async () => {
  const f = await fixture();
  const catalog = await f.call('GET', '/api/billing/catalog');
  const value = await catalog.json();
  assert.equal(value.mode, 'disabled'); assert.equal(value.paymentsReady, false);
  assert.deepEqual(value.plans.map(({ id, amount, currency, interval }) => ({ id, amount, currency, interval })), [
    { id: 'monthly', amount: 800, currency: 'BYN', interval: 'month' }, { id: 'yearly', amount: 7200, currency: 'BYN', interval: 'year' }
  ]);
  assert.equal(catalog.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await (await f.call('GET', '/api/billing/status')).json(), { mode: 'disabled', paymentsReady: false, plan: 'free', status: 'beta', periodEnd: null, renewAt: null, billingPlan: null, cancelAtPeriodEnd: false });
  for (const route of ['checkout', 'cancel']) {
    const denied = await f.call('POST', '/api/billing/' + route, { plan: 'monthly' });
    assert.equal(denied.status, 503); assert.equal((await denied.json()).error.code, 'payments_not_ready');
  }
  assert.equal(f.calls.length, 0); assert.equal(f.db.rows('billing_orders').length, 0);
  const absent = await f.worker.fetch(new Request(APP + '/api/billing/catalog'), {});
  assert.equal((await absent.json()).paymentsReady, false);
});

test('live readiness requires every merchant, database and server configuration field', async () => {
  const f = await fixture({ live: true });
  assert.equal(f.api.paymentsReady(f.env), true);
  for (const key of ['BILLING_MODE', 'BILLING_MERCHANT_APPROVED', 'BILLING_DB', 'APP_URL', 'BEPAID_SHOP_ID', 'BEPAID_SECRET_KEY', 'BEPAID_MONTHLY_PLAN_ID', 'BEPAID_YEARLY_PLAN_ID', 'BEPAID_WEBHOOK_PUBLIC_KEY']) {
    assert.equal(f.api.paymentsReady({ ...f.env, [key]: undefined }), false, key);
  }
  assert.equal(f.api.paymentsReady({ ...f.env, BILLING_MODE: 'test' }), false);
  assert.equal(f.api.paymentsReady({ ...f.env, APP_URL: 'http://localhost' }), false);
  assert.equal(f.api.paymentsReady({ ...f.env, BEPAID_YEARLY_PLAN_ID: f.env.BEPAID_MONTHLY_PLAN_ID }), false);
  assert.equal((await f.call('GET', '/api/billing/catalog')).status, 200);
});

test('private routes require Firebase identity and reject cross-site requests and wrong methods', async () => {
  const f = await fixture({ live: true });
  assert.equal((await f.call('GET', '/api/billing/status', undefined, 'unknown')).status, 401);
  assert.equal((await f.call('GET', '/api/billing/status', undefined, 'alice', { Authorization: '' })).status, 401);
  assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'monthly' }, 'alice', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'monthly' }, 'alice', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.call('POST', '/api/billing/status', {})).status, 405);
  assert.equal((await f.call('GET', '/api/billing/unknown')).status, 404);
  assert.equal(f.calls.length, 0);
});

test('checkout validates strict input before provider calls; provider price and live flag are verified', async () => {
  const f = await fixture({ live: true });
  for (const body of [{}, { plan: 'premium' }, { plan: 'monthly', amount: 1 }, { plan: 'yearly', currency: 'USD' }]) assert.equal((await f.call('POST', '/api/billing/checkout', body)).status, 400);
  assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'monthly', padding: 'x'.repeat(5000) })).status, 413);
  assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'monthly' }, 'alice', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(f.calls.length, 0);
  for (const wrong of [plan('monthly', { test: true }), plan('monthly', { currency: 'USD' }), plan('monthly', { plan: { amount: 1, interval: 1, interval_unit: 'month' } }), plan('monthly', { trial: { interval: 7 } })]) {
    const bad = await fixture({ live: true, fetcher: async () => Response.json(wrong) });
    assert.equal((await bad.call('POST', '/api/billing/checkout', { plan: 'monthly' })).status, 502);
    assert.equal(bad.db.rows('billing_orders').length, 0);
  }
});

test('checkout creates server-owned tracking, exposes only provider URL, repeats do not charge twice', async () => {
  const f = await fixture({ live: true });
  const created = await create(f);
  assert.equal(created.orderId, 'order_1'); assert.match(created.checkoutUrl, /^https:\/\/checkout.bepaid.by\/v2\//);
  const outgoing = JSON.parse(f.calls.find(call => call.options.method === 'POST').options.body);
  assert.equal(outgoing.tracking_id, 'order_1'); assert.deepEqual(outgoing.plan, { id: 'pln_monthly' });
  assert.equal(outgoing.notification_url, APP + '/api/billing/webhook'); assert.equal(outgoing.return_url, APP + '/#plans');
  assert.equal(outgoing.uid, undefined); assert.equal(outgoing.amount, undefined);
  const row = f.db.rows('billing_orders')[0];
  assert.equal(row.uid, 'alice'); assert.equal(row.amount, 800); assert.equal(row.currency, 'BYN'); assert.equal(row.paid_until, 0);
  assert.deepEqual(await (await f.call('POST', '/api/billing/checkout', { plan: 'monthly' })).json(), created);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'yearly' })).status, 409);
  assert.equal((await (await f.call('GET', '/api/billing/status')).json()).plan, 'free');
  assert.equal((await (await f.call('GET', '/api/billing/status', undefined, 'bob')).json()).billingPlan, null);
});

test('yearly price is 7200 kopecks over twelve months; parallel checkout has one provider creation', async () => {
  const f = await fixture({ live: true });
  const results = await Promise.all([f.call('POST', '/api/billing/checkout', { plan: 'yearly' }), f.call('POST', '/api/billing/checkout', { plan: 'yearly' })]);
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(f.db.rows('billing_orders').length, 1); assert.equal(f.db.rows('billing_orders')[0].amount, 7200);
});

test('gateway redirects, unsafe checkout targets and ambiguous create errors fail closed without retry', async () => {
  const redirected = await fixture({ live: true, fetcher: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }) });
  assert.equal((await redirected.call('POST', '/api/billing/checkout', { plan: 'monthly' })).status, 502);
  assert.equal(redirected.calls.length, 1);
  for (const target of ['https://evil.example/v2/checkout', 'https://checkout.bepaid.by.evil.example/v2/x', 'javascript:alert(1)']) {
    const f = await fixture({ live: true, fetcher: async (url, options) => options.method === 'GET' ? Response.json(plan()) : Response.json({ id: 'sbs_1', tracking_id: 'order_1', redirect_url: target }) });
    assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'monthly' })).status, 502);
    assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'monthly' })).status, 409);
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  }
});

test('only authentic raw-byte RSA webhook plus canonical live payment grants Plus', async () => {
  const f = await fixture({ live: true }); await create(f);
  const snapshot = pay(f), payload = { id: snapshot.id, tracking_id: snapshot.tracking_id, state: 'active' };
  const before = await f.call('GET', '/api/billing/status'); assert.equal((await before.json()).plan, 'free');
  assert.equal((await f.webhook(payload, { signature: 'AAAA' })).status, 401);
  assert.equal((await f.webhook(payload, { auth: 'Basic invalid' })).status, 401);
  const original = JSON.stringify(payload);
  const signed = await signing;
  const originalSignature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signed.pair.privateKey, Buffer.from(original))).toString('base64');
  assert.equal((await f.webhook(payload, { raw: JSON.stringify(payload, null, 2), signature: originalSignature })).status, 401, 'signature applies to exact raw bytes, not reserialized JSON');
  assert.equal((await f.webhook(payload)).status, 200);
  const state = await (await f.call('GET', '/api/billing/status')).json();
  assert.equal(state.plan, 'plus'); assert.equal(state.status, 'active'); assert.equal(state.billingPlan, 'monthly');
  assert.equal(state.periodEnd, snapshot.active_to); assert.equal(f.db.rows('billing_events').length, 1);
  const callCount = f.calls.length;
  assert.deepEqual(await (await f.webhook(payload)).json(), { received: true, duplicate: true });
  assert.equal(f.calls.length, callCount);
  assert.equal((await (await f.call('GET', '/api/billing/status', undefined, 'bob')).json()).plan, 'free');
  f.setTime(START + 31 * DAY);
  const expired = await (await f.call('GET', '/api/billing/status')).json(); assert.equal(expired.plan, 'free'); assert.equal(expired.status, 'expired');
});

test('canonical test payments, wrong ownership, wrong price and impossible periods never grant access', async () => {
  const invalid = [
    snapshot => { snapshot.plan.test = true; },
    snapshot => { snapshot.test = true; },
    snapshot => { snapshot.tracking_id = 'someone_else'; },
    snapshot => { snapshot.plan.currency = 'USD'; },
    snapshot => { snapshot.plan.plan.amount = 1; },
    snapshot => { snapshot.active_to = '2099-01-01T00:00:00Z'; },
    snapshot => { snapshot.renew_at = 'bad date'; },
    snapshot => { snapshot.paid_billing_cycles = 0; }
  ];
  for (const change of invalid) {
    const f = await fixture({ live: true }); await create(f);
    const snapshot = pay(f); change(snapshot);
    const result = await f.webhook({ id: snapshot.id, tracking_id: 'order_1' });
    assert.ok([200, 502].includes(result.status));
    assert.equal((await (await f.call('GET', '/api/billing/status')).json()).plan, 'free');
  }
});

test('signed stale events re-read current provider status instead of trusting webhook claims', async () => {
  const f = await fixture({ live: true }); await create(f);
  const snapshot = pay(f);
  const event = { id: snapshot.id, tracking_id: 'order_1', state: 'active' };
  await f.webhook(event);
  snapshot.state = 'canceled'; snapshot.renew_at = null;
  assert.equal((await f.webhook({ ...event, old: true })).status, 200);
  const state = await (await f.call('GET', '/api/billing/status')).json();
  assert.equal(state.status, 'canceled'); assert.equal(state.plan, 'plus'); assert.equal(state.cancelAtPeriodEnd, true); assert.equal(state.renewAt, null);
});

test('cancel acts on authenticated account only, confirms provider cancellation, retains verified paid time', async () => {
  const f = await fixture({ live: true }); await create(f); const snapshot = pay(f);
  await f.webhook({ id: snapshot.id, tracking_id: 'order_1' });
  assert.equal((await f.call('POST', '/api/billing/cancel', {}, 'bob')).status, 409);
  assert.equal((await f.call('POST', '/api/billing/cancel', { id: snapshot.id })).status, 400);
  const cancellation = await f.call('POST', '/api/billing/cancel', {});
  assert.equal(cancellation.status, 200); assert.deepEqual(await cancellation.json(), { canceled: true, periodEnd: snapshot.active_to });
  const count = f.calls.length;
  assert.equal((await f.call('POST', '/api/billing/cancel', {})).status, 200); assert.equal(f.calls.length, count);
  assert.equal((await f.call('POST', '/api/billing/checkout', { plan: 'yearly' })).status, 409);
  f.setTime(START + 31 * DAY);
  assert.equal((await (await f.call('GET', '/api/billing/status')).json()).plan, 'free');
});

test('turning billing off never leaks stored paid status or provider credentials', async () => {
  const f = await fixture({ live: true }); await create(f); const snapshot = pay(f);
  await f.webhook({ id: snapshot.id, tracking_id: 'order_1' });
  f.env.BILLING_MODE = 'disabled';
  const value = await (await f.call('GET', '/api/billing/status')).json(); assert.equal(value.plan, 'free'); assert.equal(value.status, 'beta');
  const serialized = JSON.stringify(await (await f.call('GET', '/api/billing/catalog')).json()) + JSON.stringify(value);
  assert.doesNotMatch(serialized, /test-only-secret|BEGIN PUBLIC KEY|pln_monthly|sbs_order/);
  assert.equal((await f.webhook({ id: snapshot.id, tracking_id: 'order_1' })).status, 503);
});

test('a canceled unpaid checkout cannot acquire Plus from a supplied future end date', async () => {
  const f = await fixture({ live: true }); await create(f);
  const snapshot = f.providerState.get('sbs_order_1');
  snapshot.state = 'canceled'; snapshot.active_to = new Date(START + 30 * DAY).toISOString();
  assert.equal((await f.webhook({ id: snapshot.id, tracking_id: 'order_1' })).status, 200);
  const state = await (await f.call('GET', '/api/billing/status')).json();
  assert.equal(state.plan, 'free'); assert.equal(state.periodEnd, null);
});

test('SQL checks prevent inconsistent prices and bind one open subscription per account', async () => {
  const f = await fixture({ live: true }); await create(f);
  assert.throws(() => f.db.sqlite.prepare("UPDATE billing_orders SET amount = 7200 WHERE plan_id = 'monthly'").run(), /CHECK constraint/);
  assert.throws(() => f.db.sqlite.prepare("UPDATE billing_orders SET currency = 'USD'").run(), /CHECK constraint/);
  assert.throws(() => f.db.sqlite.prepare("INSERT INTO billing_orders (id, uid, plan_id, amount, currency, provider_plan_id, state, created_at, updated_at) VALUES ('another','alice','monthly',800,'BYN','pln_monthly','creating',0,0)").run(), /UNIQUE constraint/);
});
