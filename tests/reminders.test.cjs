const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assistant-reminders.js'), 'utf8');
const OWNER_KEY = 'hvf-reminders-device-v1';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
const record = (id, fields = {}) => ({ id, kind: 'task', month: '2026-10', date: '2026-10-24', title: id, time: '10:00', reminderMinutes: 10, ...fields });

function client(options = {}) {
  const timers = new Map(), calls = [], events = new Map(), storage = new Map();
  let timerId = 0, listener, prompts = 0, subscriptions = 0, unsubscriptions = 0;
  let state = options.state || { records: {}, user: { uid: 'alice' }, status: 'synced' };
  let network = options.network;
  let currentSubscription = options.existing ? subscription() : null;
  if (options.owner) storage.set(OWNER_KEY, JSON.stringify(options.owner));
  function subscription() {
    const value = {
      endpoint: 'https://push.example/device-' + (++subscriptions),
      toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'device-public-key', auth: 'device-auth' } }; },
      async unsubscribe() { calls.push({ action: 'unsubscribe', endpoint: this.endpoint }); unsubscriptions++; if (currentSubscription === this) currentSubscription = null; return true; },
    };
    return value;
  }
  const store = {
    getState: () => state,
    subscribe(callback) { listener = callback; callback(state); return () => { listener = null; }; },
    getIdToken: options.getIdToken || (async () => 'jwt-' + state.user?.uid),
  };
  const registration = {
    ...(options.workerURL ? { active: { scriptURL: options.workerURL } } : {}),
    pushManager: {
      async getSubscription() { return currentSubscription; },
      async subscribe(settings) { calls.push({ action: 'subscribe', settings }); currentSubscription = subscription(); return currentSubscription; },
    },
  };
  const Notification = {
    permission: options.permission || 'default',
    requestPermission() {
      prompts++; calls.push({ action: 'permission' });
      if (options.permissionPromise) return options.permissionPromise;
      this.permission = options.denied ? 'denied' : 'granted';
      return Promise.resolve(this.permission);
    },
  };
  const window = {
    isSecureContext: !options.insecure,
    navigator: {
      userAgent: options.ios ? 'iPhone OS 18' : 'Chrome', standalone: Boolean(options.installed),
      serviceWorker: options.unsupported ? undefined : { ready: Promise.resolve(registration) },
    },
    PushManager: options.unsupported ? undefined : function PushManager() {},
    Notification, HVFStore: store,
    HVF_REMINDERS_CONFIG: { endpoint: options.unconfigured ? '' : 'https://reminders.example' },
    matchMedia: () => ({ matches: Boolean(options.installed) }),
    localStorage: { getItem: id => storage.get(id) || null, setItem: (id, value) => storage.set(id, value), removeItem: id => storage.delete(id) },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    addEventListener: (name, callback) => events.set(name, callback),
    async fetch(url, settings) {
      const call = { url, ...settings, payload: settings.body ? JSON.parse(settings.body) : undefined };
      calls.push(call);
      if (network) { const response = await network(call); if (response) return response; }
      return { ok: true, status: 200, json: async () => url.endsWith('/v1/config') ? { publicKey: key } : { ok: true } };
    },
  };
  vm.runInNewContext(source, {
    window, URL, Uint8Array, Set, Map, Date, JSON,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    api: window.HVFReminders, window, store, calls, timers, storage, events,
    get prompts() { return prompts; }, get unsubscriptions() { return unsubscriptions; },
    get subscription() { return currentSubscription; },
    setNetwork(value) { network = value; },
    setState(value) { state = value; listener?.(value); },
    async runTimers(delay = 450) {
      const selected = [...timers].filter(([, value]) => value.delay === delay);
      for (const [id, value] of selected) { timers.delete(id); value.callback(); }
      await flush();
    },
    plans: () => calls.filter(call => call.url?.endsWith('/v1/plan')),
    devices: () => calls.filter(call => call.url?.endsWith('/v1/devices')),
  };
}

test('loading the module does not request permission, register devices, or initialize the store', () => {
  const page = client();
  assert.equal(page.calls.length, 0);
  assert.equal(page.prompts, 0);
  assert.equal(page.api.getStatus().initialized, false);
});

test('cloud-acknowledged edits sync even with notifications disabled and omit all financial data', async () => {
  const records = {
    a: record('a', { secret: 'omit', amount: 50 }),
    b: record('b', { kind: 'routine', weekdays: [3, 1, 1], startDate: '2026-10-01', reminderMinutes: 0 }),
    c: record('c', { kind: 'routine-skip', routineId: 'b', occurrenceDate: '2026-10-24' }),
    d: record('d', { reminderMinutes: null, routineId: 'b', occurrenceDate: '2026-10-25' }),
    ordinaryOff: record('off', { reminderMinutes: null, title: 'Private task without a reminder' }),
    legacy: record('legacy', { reminderMinutes: undefined, title: 'Private legacy task' }),
    money: { id: 'money', kind: 'income', amount: 4500, title: 'Private income' },
    goal: { id: 'goal', kind: 'goal', saved: 500, title: 'Private goal' },
  };
  const page = client({ state: { records, user: { uid: 'alice' }, status: 'syncing' } });
  await page.api.init();
  await page.runTimers();
  assert.equal(page.plans().length, 0);
  page.setState({ records, user: { uid: 'alice' }, status: 'synced' });
  await page.runTimers();
  assert.equal(page.plans().length, 1);
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.prompts, 0);
  const plan = page.plans()[0];
  assert.equal(plan.headers.Authorization, 'Bearer jwt-alice');
  assert.equal(plan.credentials, 'omit');
  assert.equal(plan.redirect, 'error');
  assert.deepEqual(plan.payload.records.map(value => value.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(plan.payload.records[1].weekdays, [1, 3]);
  assert.equal(plan.payload.records[1].reminderMinutes, 0);
  assert.equal(plan.payload.records[3].reminderMinutes, null);
  assert.ok(!JSON.stringify(plan.payload).includes('Private'));
  assert.ok(!JSON.stringify(plan.payload).includes('amount'));
  assert.ok(!JSON.stringify(plan.payload).includes('secret'));
  page.setState({ records, user: { uid: 'alice' }, status: 'synced' });
  await page.runTimers();
  assert.equal(page.plans().length, 1, 'identical snapshots are not uploaded twice');
});

test('debounce coalesces task changes and an empty snapshot clears server reminders', async () => {
  const page = client();
  await page.api.init();
  for (const title of ['first', 'second', 'final']) page.setState({ records: { a: record('a', { title }) }, user: { uid: 'alice' }, status: 'synced' });
  await page.runTimers();
  assert.equal(page.plans().length, 1);
  assert.equal(page.plans()[0].payload.records[0].title, 'final');
  page.setState({ records: {}, user: { uid: 'alice' }, status: 'synced' });
  await page.runTimers();
  assert.equal(page.plans().length, 2);
  assert.deepEqual(page.plans()[1].payload.records, []);
});

test('enable requests permission in the user gesture and reports enabled only after backend acknowledgement', async () => {
  const acknowledgement = deferred();
  const page = client({ network: call => call.url.endsWith('/v1/devices') ? acknowledgement.promise : null });
  await page.api.init();
  const enabling = page.api.enable();
  assert.equal(page.prompts, 1, 'permission is requested synchronously');
  assert.equal(page.calls[0].action, 'permission');
  await flush();
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.api.getStatus().busy, true);
  assert.equal(page.devices().length, 1);
  const subscription = page.calls.find(value => value.action === 'subscribe');
  assert.equal(subscription.settings.userVisibleOnly, true);
  assert.equal(subscription.settings.applicationServerKey.length, 65);
  acknowledgement.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  assert.equal(await enabling, true);
  assert.equal(page.api.getStatus().enabled, true);
  assert.equal(page.api.getStatus().busy, false);
  assert.equal(JSON.parse(page.storage.get(OWNER_KEY)).uid, 'alice');
});

test('permission rejection and backend rejection leave reminders disabled with useful errors', async () => {
  const denied = client({ denied: true });
  await denied.api.init();
  await assert.rejects(denied.api.enable(), /Уведомления не разрешены/);
  assert.equal(denied.api.getStatus().enabled, false);
  assert.equal(denied.devices().length, 0);
  const rejected = client({ permission: 'granted', network: call => call.url.endsWith('/v1/devices') ? { ok: false, status: 503 } : null });
  await rejected.api.init();
  await assert.rejects(rejected.api.enable(), /503/);
  assert.equal(rejected.api.getStatus().enabled, false);
  assert.equal(rejected.unsubscriptions, 1);
  assert.equal(rejected.storage.has(OWNER_KEY), false);
});

test('iPhone requires home-screen installation; unsupported browsers can still update other devices plans', async () => {
  const iphone = client({ ios: true });
  await iphone.api.init();
  assert.equal(iphone.api.getStatus().needsInstall, true);
  await assert.rejects(iphone.api.enable(), /На экран Домой/);
  assert.equal(iphone.prompts, 0);
  const installed = client({ ios: true, installed: true });
  await installed.api.init();
  assert.equal(await installed.api.enable(), true);
  const unsupported = client({ unsupported: true });
  await unsupported.api.init();
  await assert.rejects(unsupported.api.enable(), /не поддерживает/);
  await unsupported.runTimers();
  assert.equal(unsupported.plans().length, 1);
  assert.equal(unsupported.prompts, 0);
});

test('anonymous, unconfigured, and unsynchronized clients never request notification permission', async () => {
  for (const options of [
    { unconfigured: true },
    { state: { records: {}, user: null, status: 'local' } },
    { state: { records: {}, user: { uid: 'alice' }, status: 'offline' } },
  ]) {
    const page = client(options);
    await page.api.init();
    await assert.rejects(page.api.enable());
    await page.runTimers();
    assert.equal(page.prompts, 0);
    assert.equal(page.plans().length, 0);
  }
});

test('disable unregisters the device and browser subscription and test uses the authenticated endpoint', async () => {
  const page = client();
  await page.api.init();
  await page.api.enable();
  const address = page.subscription.endpoint;
  assert.equal(await page.api.test(), true);
  const sent = page.calls.find(value => value.url?.endsWith('/v1/test'));
  assert.equal(sent.headers.Authorization, 'Bearer jwt-alice');
  assert.equal(sent.payload.endpoint, address);
  assert.equal(await page.api.disable(), true);
  assert.equal(page.devices().at(-1).method, 'DELETE');
  assert.equal(page.devices().at(-1).payload.endpoint, address);
  assert.equal(page.unsubscriptions, 1);
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.storage.has(OWNER_KEY), false);
  await assert.rejects(page.api.test(), /Сначала включите/);
});

test('an existing owned subscription restores without permission prompts and is acknowledged again', async () => {
  const page = client({ existing: true, permission: 'granted', owner: { uid: 'alice', endpoint: 'https://push.example/device-1' } });
  await page.api.init();
  assert.equal(page.api.getStatus().enabled, true);
  assert.equal(page.prompts, 0);
  assert.equal(page.devices().length, 1);
  assert.equal(page.devices()[0].headers.Authorization, 'Bearer jwt-alice');
});

test('initial Firebase session restoration does not delete a subscription before the owner is known', async () => {
  const page = client({ existing: true, permission: 'granted', owner: { uid: 'alice', endpoint: 'https://push.example/device-1' }, state: { records: {}, user: null, status: 'loading' } });
  await page.api.init();
  assert.equal(page.unsubscriptions, 0);
  page.setState({ records: {}, user: { uid: 'alice' }, status: 'synced' });
  await flush();
  assert.equal(page.api.getStatus().enabled, true);
  assert.equal(page.unsubscriptions, 0);
});

test('another account never inherits an existing browser subscription', async () => {
  const page = client({ existing: true, permission: 'granted', owner: { uid: 'bob', endpoint: 'https://push.example/device-1' } });
  await page.api.init();
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.devices().filter(value => value.method === 'POST').length, 0);
  assert.equal(page.unsubscriptions, 1);
  assert.equal(page.storage.has(OWNER_KEY), false);
});

test('logout stops browser delivery immediately while old-account backend cleanup is still pending', async () => {
  const cleanup = deferred();
  const page = client();
  await page.api.init();
  await page.api.enable();
  page.setNetwork(call => call.url.endsWith('/v1/devices') && call.method === 'DELETE' ? cleanup.promise : null);
  page.setState({ records: {}, user: null, status: 'local' });
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.unsubscriptions, 1, 'unsubscribe begins without waiting for the cleanup response');
  assert.equal(page.devices().at(-1).headers.Authorization, 'Bearer jwt-alice');
  assert.equal(page.storage.has(OWNER_KEY), false);
  cleanup.resolve({ ok: true, status: 200, json: async () => ({}) });
  await flush();
  assert.equal(page.api.getStatus().uid, '');
});

test('a token resolved after an account switch cannot upload the previous account data', async () => {
  const token = deferred();
  let tokens = 0;
  const page = client({ getIdToken: () => ++tokens === 1 ? token.promise : Promise.resolve('jwt-bob') });
  await page.api.init();
  const first = page.api.sync();
  await flush();
  page.setState({ records: { b: record('bob-task') }, user: { uid: 'bob' }, status: 'synced' });
  token.resolve('jwt-alice');
  await first;
  await page.runTimers();
  await flush();
  assert.equal(page.plans().length, 1);
  assert.equal(page.plans()[0].headers.Authorization, 'Bearer jwt-bob');
  assert.equal(page.plans()[0].payload.records[0].id, 'bob-task');
  assert.equal(page.api.getStatus().uid, 'bob');
});

test('an enable response from a previous account cannot enable notifications for the new account', async () => {
  const acknowledgement = deferred();
  const page = client({ network: call => call.url.endsWith('/v1/devices') && call.method === 'POST' ? acknowledgement.promise : null });
  await page.api.init();
  const first = page.api.enable();
  await flush();
  assert.equal(page.devices().length, 1);
  page.setState({ records: {}, user: { uid: 'bob' }, status: 'synced' });
  acknowledgement.resolve({ ok: true, status: 200, json: async () => ({}) });
  assert.equal(await first, false);
  await flush();
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.api.getStatus().uid, 'bob');
  assert.equal(page.storage.has(OWNER_KEY), false);
});

test('failed plan delivery retries without automatic permission prompts or an unhandled rejection', async () => {
  const page = client({ network: call => call.url.endsWith('/v1/plan') ? { ok: false, status: 503 } : null });
  await page.api.init();
  await page.runTimers();
  assert.match(page.api.getStatus().error, /503/);
  assert.equal(page.timers.size, 1);
  page.setNetwork(null);
  await page.runTimers(30000);
  assert.equal(page.plans().length, 2);
  assert.equal(page.api.getStatus().error, '');
  assert.equal(page.prompts, 0);
});

test('pending local edits cancel the debounce until the cloud acknowledges the new snapshot', async () => {
  const page = client({ state: { records: { a: record('a') }, user: { uid: 'alice' }, status: 'synced' } });
  await page.api.init();
  page.setState({ records: {}, user: { uid: 'alice' }, status: 'syncing' });
  await page.runTimers();
  assert.equal(page.plans().length, 0);
  page.setState({ records: {}, user: { uid: 'alice' }, status: 'synced' });
  await page.runTimers();
  assert.equal(page.plans().length, 1);
  assert.deepEqual(page.plans()[0].payload.records, []);
});

test('plan requests are serialized and a later edit replaces all earlier queued edits', async () => {
  const firstResponse = deferred();
  const page = client({
    state: { records: { a: record('a', { title: 'first' }) }, user: { uid: 'alice' }, status: 'synced' },
    network: call => call.url.endsWith('/v1/plan') && call.payload.records[0]?.title === 'first' ? firstResponse.promise : null,
  });
  await page.api.init();
  const pending = page.api.sync();
  await flush();
  for (const title of ['second', 'final']) page.setState({ records: { a: record('a', { title }) }, user: { uid: 'alice' }, status: 'synced' });
  await page.runTimers();
  assert.equal(page.plans().length, 1);
  firstResponse.resolve({ ok: true, status: 200, json: async () => ({}) });
  assert.equal(await pending, true);
  assert.equal(page.plans().length, 2);
  assert.deepEqual(page.plans().map(value => value.payload.records[0].title), ['first', 'final']);
});

test('a new account can enable while previous-account backend cleanup is still pending', async () => {
  const oldCleanup = deferred();
  const page = client();
  await page.api.init();
  await page.api.enable();
  page.setNetwork(call => call.url.endsWith('/v1/devices') && call.method === 'DELETE' ? oldCleanup.promise : null);
  page.setState({ records: {}, user: { uid: 'bob' }, status: 'synced' });
  assert.equal(await page.api.enable(), true);
  assert.equal(page.api.getStatus().uid, 'bob');
  assert.equal(page.api.getStatus().enabled, true);
  const newDevice = page.devices().filter(value => value.method === 'POST').at(-1);
  assert.equal(newDevice.headers.Authorization, 'Bearer jwt-bob');
  assert.equal(newDevice.payload.subscription.endpoint, 'https://push.example/device-2');
  oldCleanup.resolve({ ok: true, status: 200, json: async () => ({}) });
});

test('an old active service worker cannot create a push subscription before the reminder update activates', async () => {
  for (const workerURL of [
    'https://haveffee.github.io/daily-schedule/service-worker.js',
    'https://haveffee.github.io/daily-schedule/service-worker.js?v=previous',
  ]) {
    const page = client({ workerURL, permission: 'granted' });
    await page.api.init();
    await assert.rejects(page.api.enable(), /Закройте все окна HVF/);
    assert.equal(page.calls.some(value => value.action === 'subscribe'), false);
    assert.equal(page.devices().length, 0);
    assert.equal(page.api.getStatus().enabled, false);
  }
  const updated = client({ workerURL: 'https://haveffee.github.io/daily-schedule/service-worker.js?v=reminders-1' });
  await updated.api.init();
  assert.equal(await updated.api.enable(), true);
  assert.equal(updated.devices().length, 1);
  const staleOwner = client({ workerURL: 'https://haveffee.github.io/daily-schedule/service-worker.js', existing: true, permission: 'granted', owner: { uid: 'bob', endpoint: 'https://push.example/device-1' } });
  await staleOwner.api.init();
  assert.equal(staleOwner.unsubscriptions, 1, 'account cleanup can always unsubscribe, even while an update is waiting');
});

test('plan validation errors keep the backend explanation when enabling instead of replacing it with a generic message', async () => {
  const reason = 'Некорректная дата occurrenceDate.';
  const page = client({ network: call => call.url.endsWith('/v1/plan') ? { ok: false, status: 400, json: async () => ({ error: reason, code: 'invalid_record' }) } : null });
  await page.api.init();
  await assert.rejects(page.api.enable(), failure => failure.message.includes(reason) && failure.message.includes('HTTP 400'));
  assert.ok(page.api.getStatus().error.includes(reason));
  assert.equal(page.api.getStatus().error.includes('Не удалось передать дела'), false);
  assert.equal(page.api.getStatus().enabled, false);
  assert.equal(page.devices().length, 0);
  assert.equal(page.unsubscriptions, 1);
});

test('authentication errors identify the HTTP status and preserve the trusted backend reason', async () => {
  for (const status of [401, 403]) {
    const reason = 'Войди в Google ещё раз, чтобы подключить напоминания.';
    const page = client({ network: call => call.url.endsWith('/v1/plan') ? { ok: false, status, json: async () => ({ error: reason, code: 'unauthorized' }) } : null });
    await page.api.init();
    await assert.rejects(page.api.enable(), failure => failure.message.includes('Сервис не подтвердил вход') && failure.message.includes('HTTP ' + status) && failure.message.includes(reason));
    assert.ok(page.api.getStatus().error.includes('HTTP ' + status));
    assert.equal(page.devices().length, 0);
  }
});

test('malformed, oversized, or unknown backend error bodies fall back to a safe status message', async () => {
  for (const body of [
    { error: 'Do not show proxy details', code: 'unknown_proxy_error' },
    { error: 'x'.repeat(501), code: 'invalid_record' },
    { error: 'Injected\ncontrol', code: 'invalid_record' },
    { error: { private: true }, code: 'invalid_record' },
  ]) {
    const page = client({ network: call => call.url.endsWith('/v1/plan') ? { ok: false, status: 400, json: async () => body } : null });
    await page.api.init();
    await assert.rejects(page.api.enable(), /Сервис напоминаний временно недоступен \(HTTP 400\)/);
  }
});
