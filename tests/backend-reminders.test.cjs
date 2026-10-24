const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const backend = import('../backend/reminders/worker.mjs');

// The production SQL runs against real SQLite, including RETURNING, JSON1,
// foreign keys and batch transactions. Only Cloudflare's small API is adapted.
class D1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    const migrations = path.join(__dirname, '../backend/reminders/migrations');
    for (const filename of fs.readdirSync(migrations).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      this.sqlite.exec(fs.readFileSync(path.join(migrations, filename), 'utf8'));
    }
    this.queries = 0;
  }
  prepare(sql) {
    const database = this;
    const prepare = values => ({
      bind(...parameters) { return prepare(parameters); },
      async first() { database.queries += 1; return database.sqlite.prepare(sql).get(...values) || null; },
      async all() { database.queries += 1; return { results: database.sqlite.prepare(sql).all(...values) }; },
      async run() {
        database.queries += 1;
        const result = database.sqlite.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      }
    });
    return prepare([]);
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  rows(table) { return this.sqlite.prepare('SELECT * FROM ' + table).all(); }
}

const start = Date.parse('2026-10-24T06:55:00Z'); // Minsk 09:55
function task(extra = {}) { return { kind: 'task', id: 'task-1', title: 'Репетитор', date: '2026-10-24', time: '10:00', reminderMinutes: 5, done: false, ...extra }; }
function routine(extra = {}) { return { kind: 'routine', id: 'routine-1', title: 'Английский', startDate: '2026-10-24', untilDate: '', time: '10:00', reminderMinutes: 5, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true, ...extra }; }
const keys = (async () => {
  const recipient = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    p256dh: Buffer.from(await crypto.subtle.exportKey('raw', recipient.publicKey)).toString('base64url'),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
    publicKey: Buffer.from(await crypto.subtle.exportKey('raw', vapid.publicKey)).toString('base64url'),
    privateKey: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d
  };
})();
async function subscription(suffix = 'one') {
  const value = await keys;
  return { endpoint: 'https://web.push.apple.com/' + suffix, keys: { p256dh: value.p256dh, auth: value.auth } };
}
async function fixture(send) {
  const api = await backend, key = await keys, db = new D1Database();
  let time = start;
  const env = { DB: db, VAPID_PUBLIC_KEY: key.publicKey, VAPID_PRIVATE_KEY: key.privateKey, VAPID_SUBJECT: api.APP_URL };
  const sent = [];
  const worker = api.createWorker({
    now: () => time,
    verifyToken: async token => {
      if (token === 'alice-token') return 'alice';
      if (token === 'bob-token') return 'bob';
      throw new api.ApiError(401, 'unauthorized', 'Войди в аккаунт.');
    },
    sendPush: async (device, payload, config, ttl) => {
      sent.push({ device, payload, ttl });
      return send ? send(device, payload) : new Response(null, { status: 201 });
    }
  });
  const call = (method, route, body, who = 'alice', extraHeaders = {}) => worker.fetch(new Request('https://hvf-reminders.example' + route, {
    method, headers: { Origin: api.APP_ORIGIN, Authorization: 'Bearer ' + who + '-token', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  return { api, db, env, worker, call, sent, repo: new api.Repository(db), setTime: value => { time = value; } };
}
async function seed(f, records = [task()], suffix = 'one', uid = 'alice') {
  await f.repo.ensureAccount(uid, start);
  const sub = await subscription(suffix);
  await f.repo.register(uid, sub, start);
  await f.repo.replacePlan(uid, f.api.validateRecords(records), start);
  await f.repo.materialize(uid, start);
  return sub;
}

test('public configuration and health expose no credentials; CORS admits only the app origin', async () => {
  const f = await fixture();
  const config = await f.call('GET', '/v1/config');
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { publicKey: f.env.VAPID_PUBLIC_KEY });
  assert.equal(config.headers.get('Access-Control-Allow-Origin'), f.api.APP_ORIGIN);
  assert.equal((await f.call('GET', '/v1/health')).status, 200);
  assert.equal((await f.call('GET', '/v1/config', undefined, 'alice', { Origin: 'https://evil.example' })).status, 403);
  const preflight = await f.call('OPTIONS', '/v1/plan');
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const missing = await f.call('GET', '/unknown');
  assert.equal(missing.status, 404);
});

test('mutating routes require an authenticated Firebase user and configured service', async () => {
  const f = await fixture();
  assert.equal((await f.call('PUT', '/v1/plan', { records: [] }, 'unknown')).status, 401);
  assert.equal(f.db.rows('accounts').length, 0);
  delete f.env.VAPID_PRIVATE_KEY;
  assert.equal((await f.call('POST', '/v1/devices', { subscription: await subscription() })).status, 503);
});

test('Firebase verification rejects forged, expired and wrong-project ID tokens', async () => {
  const api = await backend;
  const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey); jwk.kid = 'test-google-key';
  let keyRequests = 0;
  const verify = api.tokenVerifier(async (url, options) => {
    if (options.redirect === 'error') throw new TypeError('Workers supports only follow or manual redirects');
    assert.equal(options.redirect, 'manual');
    assert.equal(url, api.GOOGLE_JWKS); keyRequests += 1;
    return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  });
  async function token(overrides = {}, headerOverride = {}) {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, ...headerOverride })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'alice', aud: api.FIREBASE_PROJECT, iss: 'https://securetoken.google.com/' + api.FIREBASE_PROJECT, iat: start / 1000 - 10, auth_time: start / 1000 - 60, exp: start / 1000 + 3600, ...overrides })).toString('base64url');
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, Buffer.from(head + '.' + body));
    return head + '.' + body + '.' + Buffer.from(sig).toString('base64url');
  }
  assert.equal(await verify(await token(), start), 'alice');
  assert.equal(await verify(await token(), start + 1000), 'alice');
  assert.equal(keyRequests, 1);
  await assert.rejects(() => verify(token(), start), { status: 401 }); // promise is not a token
  for (const claims of [{ aud: 'other-project' }, { iss: 'https://evil.example' }, { sub: '' }, { exp: start / 1000 }, { iat: start / 1000 + 90 }, { auth_time: start / 1000 + 90 }]) {
    await assert.rejects(() => token(claims).then(value => verify(value, start)), { status: 401 });
  }
  await assert.rejects(() => token({}, { alg: 'none' }).then(value => verify(value, start)), { status: 401 });
  const forged = (await token()).split('.');
  forged[1] = Buffer.from(JSON.stringify({ sub: 'bob', aud: api.FIREBASE_PROJECT, iss: 'https://securetoken.google.com/' + api.FIREBASE_PROJECT, iat: start / 1000, auth_time: start / 1000, exp: start / 1000 + 3600 })).toString('base64url');
  await assert.rejects(() => verify(forged.join('.'), start), { status: 401 });
});

test('the default Google key fetch is bound to its runtime and never follows redirects', async () => {
  const api = await backend, original = global.fetch;
  let calls = 0;
  global.fetch = function(url, options) {
    assert.equal(this, globalThis, 'native runtime fetch needs its global receiver');
    if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
    assert.equal(options.redirect, 'manual');
    assert.equal(url, api.GOOGLE_JWKS);
    calls++;
    return Promise.resolve(new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/keys' } }));
  };
  let verify;
  try { verify = api.tokenVerifier(); } finally { global.fetch = original; }
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = encoded({ alg: 'RS256', kid: 'test' }) + '.' + encoded({ sub: 'test', aud: api.FIREBASE_PROJECT, iss: 'https://securetoken.google.com/' + api.FIREBASE_PROJECT, iat: start / 1000 - 1, auth_time: start / 1000 - 1, exp: start / 1000 + 60 }) + '.AA';
  await assert.rejects(() => verify(token, start), { status: 401 });
  assert.equal(calls, 1, 'reject the redirect without attempting its target');
});

test('JSON size and type limits apply to streamed bodies, not only Content-Length', async () => {
  const f = await fixture();
  assert.equal((await f.call('PUT', '/v1/plan', { records: [], padding: 'x'.repeat(f.api.LIMITS.body) })).status, 413);
  assert.equal((await f.call('PUT', '/v1/plan', { records: [] }, 'alice', { 'Content-Type': 'text/plain' })).status, 415);
  const malformed = new Request('https://example/v1/plan', { method: 'PUT', headers: { Origin: f.api.APP_ORIGIN, Authorization: 'Bearer alice-token', 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await f.worker.fetch(malformed, f.env)).status, 400);
  assert.equal(f.db.rows('accounts').length, 0);
});

test('plan validation strips unrelated fields, validates repeat ranges and requires fixed reminder times', async () => {
  const api = await backend;
  const [clean] = api.validateRecords([task({ amount: 999, salary: 10000, notes: 'private-finance' })]);
  assert.equal(clean.amount, undefined); assert.equal(clean.salary, undefined); assert.equal(clean.notes, undefined);
  for (const value of [task({ time: '', reminderMinutes: 5 }), task({ reminderMinutes: 7 }), task({ date: '2026-02-30' }), routine({ weekdays: [0] }), routine({ untilDate: '2026-10-23' })]) {
    assert.throws(() => api.validateRecords([value]), { status: 400 });
  }
  assert.throws(() => api.validateRecords([{ kind: 'expense', id: 'money', amount: 50 }]), { status: 400 });
  assert.throws(() => api.validateRecords([task(), task()]), { status: 400 });
  assert.equal(api.validateRecords([task({ time: '', reminderMinutes: null })])[0].reminderMinutes, null);
});

test('subscription validation blocks private URLs, deceptive hosts, redirects and malformed crypto keys', async () => {
  const api = await backend;
  const sub = await subscription();
  for (const endpoint of ['http://web.push.apple.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://web.push.apple.com.evil.example/x', 'https://web.push.apple.com:8443/x', 'https://user:pass@web.push.apple.com/x', 'https://web.push.apple.com/x#fragment']) {
    assert.equal(api.trustedEndpoint(endpoint), false, endpoint);
    await assert.rejects(() => api.validateSubscription({ ...sub, endpoint }), { status: 400 });
  }
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://wns2-sample.notify.windows.com/w/?token=123']) assert.equal(api.trustedEndpoint(endpoint), true);
  await assert.rejects(() => api.validateSubscription({ ...sub, keys: { ...sub.keys, auth: 'short' } }), { status: 400 });
  assert.deepEqual(await api.validateSubscription(sub), sub);
});

test('accounts cannot read, test, replace or delete another account device or queue', async () => {
  const f = await fixture();
  const sub = await seed(f);
  assert.equal((await f.call('POST', '/v1/test', { endpoint: sub.endpoint }, 'bob')).status, 404);
  assert.equal((await f.call('POST', '/v1/devices', { subscription: sub }, 'bob')).status, 409);
  assert.equal((await f.call('DELETE', '/v1/devices', { endpoint: sub.endpoint }, 'bob')).status, 200);
  assert.equal((await f.call('PUT', '/v1/plan', { records: [], uid: 'alice' }, 'bob')).status, 200);
  assert.equal(f.db.rows('jobs').length, 1);
  assert.equal(f.db.rows('devices')[0].uid, 'alice');
});

test('device registration is idempotent and limits each account to five devices', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) assert.equal((await f.call('POST', '/v1/devices', { subscription: await subscription('device-' + i) })).status, 200);
  assert.equal((await f.call('POST', '/v1/devices', { subscription: await subscription('device-0') })).status, 200);
  assert.equal((await f.call('POST', '/v1/devices', { subscription: await subscription('sixth') })).status, 429);
  assert.equal(f.db.rows('devices').length, 5);
});

test('moved routine overrides suppress their original dates globally and live skips dominate overrides', async () => {
  const api = await backend, midnight = Date.parse('2026-10-24T00:00:00+03:00');
  const records = api.validateRecords([
    routine(),
    task({ id: 'moved', date: '2026-10-26', time: '12:00', routineId: 'routine-1', occurrenceDate: '2026-10-24', reminderMinutes: undefined }),
    { id: 'skip:routine-1:2026-10-25', kind: 'routine-skip', routineId: 'routine-1', occurrenceDate: '2026-10-25' }
  ]);
  const generated = api.generateJobs('alice', 'revision', records, [{ id: 'phone' }], midnight);
  assert.equal(generated.length, 2);
  assert.ok(generated.every(job => job.task_date === '2026-10-26'));
  assert.equal(generated.find(job => job.task_id === 'moved').due_at, Date.parse('2026-10-26T11:55:00+03:00'));
  records.push({ id: 'skip-original', kind: 'routine-skip', routineId: 'routine-1', occurrenceDate: '2026-10-24' });
  assert.equal(api.generateJobs('alice', 'revision', records, [{ id: 'phone' }], midnight).length, 1);
});

test('completed occurrences, explicit opt-out and stopped series do not send reminders', async () => {
  const api = await backend;
  const records = api.validateRecords([
    routine(),
    task({ id: 'done', done: true, routineId: 'routine-1', occurrenceDate: '2026-10-24' }),
    task({ id: 'off', date: '2026-10-25', routineId: 'routine-1', occurrenceDate: '2026-10-25', reminderMinutes: null })
  ]);
  assert.equal(api.generateJobs('alice', 'r', records, [{ id: 'phone' }], start).length, 1);
  assert.equal(api.generateJobs('alice', 'r', api.validateRecords([routine({ active: false })]), [{ id: 'phone' }], start).length, 0);
});

test('rolling three-day generation keeps recurring 24-hour alerts alive without reopening the app', async () => {
  const f = await fixture();
  await seed(f, [routine({ reminderMinutes: 1440 })]);
  const before = f.db.rows('jobs');
  assert.ok(before.some(job => job.task_date === '2026-10-26'));
  f.setTime(start + 86400000);
  await f.worker.scheduled({}, f.env);
  const after = f.db.rows('jobs');
  assert.ok(after.some(job => job.task_date === '2026-10-27'));
  assert.equal((await f.repo.account('alice')).materialized_day, '2026-10-25');
  assert.equal(after.filter(job => job.task_date === '2026-10-26').length, 1);
});

test('atomic claim prevents concurrent cron duplication and recovers abandoned leases', async () => {
  const f = await fixture(); await seed(f);
  const claims = await Promise.all([f.repo.claim(start), f.repo.claim(start)]);
  assert.equal(claims[0].length + claims[1].length, 1);
  assert.equal((await f.repo.claim(start + 60000)).length, 0);
  const recovered = await f.repo.claim(start + 120001);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].attempts, 2);
  assert.notEqual(recovered[0].claim_token, claims.flat()[0].claim_token);
});

test('accepted deliveries remain deduplicated across repeated snapshots and rolling rebuilds', async () => {
  const f = await fixture(); await seed(f);
  await f.worker.scheduled({}, f.env);
  assert.equal(f.sent.length, 1);
  assert.equal(f.db.rows('jobs')[0].state, 'sent');
  assert.equal(f.sent[0].payload.date, '2026-10-24');
  assert.equal(f.sent[0].payload.body, '10:00 · Репетитор');
  await f.call('PUT', '/v1/plan', { records: [task()] });
  await f.worker.scheduled({}, f.env);
  assert.equal(f.sent.length, 1);
});

test('plan replacement cancels deleted and completed jobs, including already claimed work', async () => {
  const f = await fixture(); await seed(f);
  const [claimed] = await f.repo.claim(start);
  assert.equal((await f.call('PUT', '/v1/plan', { records: [task({ done: true })] })).status, 200);
  assert.equal(await f.repo.delivery(claimed, start), null);
  assert.equal(f.db.rows('jobs').length, 0);
  await f.call('PUT', '/v1/plan', { records: [task()] });
  assert.equal(f.db.rows('jobs').length, 1);
  await f.call('PUT', '/v1/plan', { records: [] });
  await f.worker.scheduled({}, f.env);
  assert.equal(f.sent.length, 0);
});

test('stale asynchronous materialization cannot revive a superseded plan', async () => {
  const f = await fixture(); await seed(f);
  await f.repo.replacePlan('alice', f.api.validateRecords([task()]), start);
  const realDevices = f.repo.devices.bind(f.repo);
  f.repo.devices = async uid => {
    f.repo.devices = realDevices;
    const values = await realDevices(uid);
    await f.repo.replacePlan(uid, [], start + 1);
    return values;
  };
  await f.repo.materialize('alice', start);
  assert.equal(f.db.rows('jobs').length, 0);
  await f.repo.rollOne(start);
  assert.equal((await f.repo.account('alice')).materialized_day, '2026-10-24');
});

test('a future overfull window is deferred without blocking current deliveries or other account rebuilds', async () => {
  const f = await fixture();
  const later = Date.parse('2026-11-08T06:55:00Z');
  const burst = Array.from({ length: 201 }, (_, index) => task({ id: 'future-' + index, date: '2026-11-10', reminderMinutes: 0 }));
  const current = task({ id: 'today', date: '2026-11-08' });
  // This is a valid PUT on October 24: the overflowing window lies in the
  // future. Yesterday's ordinary rolling rebuild also succeeds.
  await seed(f, burst.concat(current));
  await seed(f, [current], 'bob-phone', 'bob');
  await f.repo.materialize('alice', later - 86400000);
  await f.repo.materialize('bob', later - 86400000);
  assert.equal(f.db.rows('jobs').length, 2);
  f.setTime(later);
  await f.worker.scheduled({}, f.env);
  // Alice is selected first and fails. Its existing valid job and Bob's job
  // still reach their push services in this same scheduled invocation.
  assert.equal(f.sent.length, 2);
  assert.ok(f.db.rows('jobs').every(job => job.state === 'sent'));
  const failed = await f.repo.account('alice');
  assert.equal(failed.materialize_error, 'too_many_reminders');
  assert.equal(failed.materialize_retry_at, later + 3600000);
  assert.equal(failed.materialized_day, '2026-11-07');
  // A different isolate also sees the persisted delay. Bob is rebuilt next,
  // rather than Alice monopolizing every minute until its burst is past.
  const otherWorker = f.api.createWorker({ now: () => later + 60000, sendPush: async () => { throw new Error('Already sent'); } });
  await otherWorker.scheduled({}, f.env);
  assert.equal((await f.repo.account('bob')).materialized_day, '2026-11-08');
  assert.equal((await f.repo.account('alice')).materialize_retry_at, later + 3600000);
  assert.equal(f.sent.length, 2);
  // Editing the plan clears the backoff immediately; a user need not wait an
  // hour after removing the offending burst.
  const result = await f.call('PUT', '/v1/plan', { records: [] });
  assert.equal(result.status, 200);
  const recovered = await f.repo.account('alice');
  assert.equal(recovered.materialize_error, '');
  assert.equal(recovered.materialize_retry_at, 0);
  assert.equal(recovered.materialized_day, '2026-11-08');
});

test('an isolated rebuild database failure still allows already queued jobs to be claimed', async () => {
  const f = await fixture(); await seed(f);
  const repository = new f.api.Repository(f.env.DB);
  repository.rollOne = async () => { throw new Error('One rebuild read failed'); };
  const worker = f.api.createWorker({
    now: () => start,
    repository,
    sendPush: async () => { f.sent.push({ accepted: true }); return new Response(null, { status: 201 }); }
  });
  await worker.scheduled({}, f.env);
  assert.equal(f.sent.length, 1);
  assert.equal(f.db.rows('jobs')[0].state, 'sent');
});

for (const status of [404, 410]) test('push service ' + status + ' removes expired subscription and cancels all its jobs', async () => {
  const f = await fixture(() => new Response(null, { status }));
  await seed(f, [task(), task({ id: 'later', time: '11:00' })]);
  await f.worker.scheduled({}, f.env);
  assert.equal(f.sent.length, 1);
  assert.equal(f.db.rows('devices').length, 0);
  assert.equal(f.db.rows('jobs').length, 0);
});

test('transient delivery retries are leased and obsolete reminders expire after ten minutes', async () => {
  let calls = 0;
  const f = await fixture(() => new Response(null, { status: ++calls === 1 ? 503 : 201 }));
  await seed(f);
  await f.worker.scheduled({}, f.env);
  assert.equal(f.db.rows('jobs')[0].state, 'pending');
  await f.worker.scheduled({}, f.env);
  assert.equal(calls, 1);
  f.setTime(start + 60000);
  await f.worker.scheduled({}, f.env);
  assert.equal(calls, 2);
  assert.equal(f.db.rows('jobs')[0].state, 'sent');
  const late = await fixture(); await seed(late);
  late.setTime(start + 600001);
  await late.worker.scheduled({}, late.env);
  assert.equal(late.sent.length, 0);
});

test('manual test is rate limited and rejects expired subscriptions without reporting success', async () => {
  const f = await fixture(); const sub = await seed(f);
  assert.equal((await f.call('POST', '/v1/test', { endpoint: sub.endpoint })).status, 200);
  assert.equal((await f.call('POST', '/v1/test', { endpoint: sub.endpoint })).status, 429);
  const expired = await fixture(() => new Response(null, { status: 410 }));
  const expiredSub = await seed(expired);
  assert.equal((await expired.call('POST', '/v1/test', { endpoint: expiredSub.endpoint })).status, 410);
  assert.equal(expired.db.rows('devices').length, 0);
});

test('queue and account guards keep a single-user free deployment bounded', async () => {
  const f = await fixture();
  for (let i = 0; i < f.api.LIMITS.accounts; i++) await f.repo.ensureAccount('user-' + i, start);
  await assert.rejects(() => f.repo.ensureAccount('one-too-many', start), { status: 429 });
  const records = Array.from({ length: f.api.LIMITS.occurrences + 1 }, (_, i) => task({ id: 'task-' + i }));
  assert.throws(() => f.api.generateJobs('alice', 'r', f.api.validateRecords(records), [], start), { code: 'too_many_reminders' });
});

test('bulk materialization stays under the Workers Free D1 query ceiling', async () => {
  const f = await fixture();
  const records = Array.from({ length: 100 }, (_, i) => task({ id: 'task-' + i }));
  await seed(f, records);
  for (let i = 1; i < 5; i++) await f.repo.register('alice', await subscription('more-' + i), start);
  f.db.queries = 0;
  await f.repo.materialize('alice', start);
  assert.equal(f.db.rows('jobs').length, 500);
  assert.ok(f.db.queries < 10, 'A bulk INSERT must use JSON1, rather than one query per job.');
});

test('the real WebCrypto package builds Apple-compatible encrypted VAPID requests', async () => {
  const f = await fixture(), sub = await subscription('crypto-smoke');
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (endpoint, request) => {
    if (request.redirect === 'error') throw new TypeError('Workers supports only follow or manual redirects');
    captured = { endpoint, request };
    return new Response(null, { status: 201 });
  };
  try {
    const response = await f.api.sendWebPush(sub, { title: 'HVF', body: 'Проверка', url: f.api.APP_URL }, f.env, 60);
    assert.equal(response.status, 201);
    assert.equal(captured.endpoint, sub.endpoint);
    const headers = new Headers(captured.request.headers);
    assert.match(headers.get('Authorization'), /^vapid t=/);
    assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
    assert.equal(headers.get('TTL'), '60');
    assert.equal(captured.request.redirect, 'manual');
    assert.equal(captured.request.body.byteLength, 4096);
    const ciphertext = Buffer.from(captured.request.body);
    assert.equal(ciphertext.includes(Buffer.from('Проверка')), false);
  } finally { global.fetch = originalFetch; }
});
