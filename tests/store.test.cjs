const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assistant-store.js'), 'utf8')
  .replace(/import\("https:\/\/www\.gstatic\.com\/firebasejs\/13\.0\.0\/firebase-(app|auth|firestore)\.js"\)/g,
    (_, name) => `Promise.resolve(__firebase.${name})`);
const copy = value => JSON.parse(JSON.stringify(value));
const settle = async () => {
  for (let i = 0; i < 16; i += 1) await new Promise(resolve => setImmediate(resolve));
};

class Backend {
  constructor() {
    this.documents = new Map();
    this.listeners = new Set();
    this.writes = [];
    this.held = [];
    this.holdWrites = false;
    this.legacyDays = new Map();
  }
  snapshot(uid, fromCache = false) {
    const docs = [...this.documents.entries()]
      .filter(([key]) => key.startsWith(uid + '/'))
      .map(([key, value]) => ({ id: key.slice(uid.length + 1), data: () => copy(value) }));
    return { docs, metadata: { fromCache } };
  }
  publish() {
    for (const listener of this.listeners) {
      if (listener.client.navigator.onLine) listener.callback(this.snapshot(listener.uid));
    }
  }
  async write(client, reference, payload, options) {
    assert.equal(reference.parts[0], 'users');
    assert.equal(reference.parts[2], 'planning');
    assert.equal(reference.parts.length, 4);
    const [field, id] = options.mergeFields[0].parts;
    assert.equal(field, 'assistantV2');
    assert.equal(options.mergeFields.length, 1, 'a write merges exactly one record');
    const envelope = copy(payload.assistantV2[id]);
    const key = reference.parts[1] + '/' + reference.parts[3];
    const commit = () => {
      const document = this.documents.get(key) || {};
      document.assistantV2 = { ...document.assistantV2, [id]: envelope };
      this.documents.set(key, document);
      this.writes.push({ uid: reference.parts[1], month: reference.parts[3], id, envelope });
      this.publish();
    };
    if (this.holdWrites) return new Promise(resolve => this.held.push(() => { commit(); resolve(); }));
    commit();
  }
  releaseOne() {
    assert.ok(this.held.length, 'a write is waiting');
    this.held.shift()();
  }
}

function client(backend = new Backend(), storage = new Map()) {
  const events = new Map();
  const navigator = { onLine: true };
  const callbacks = [];
  const auth = { currentUser: null, authStateReady: async () => {} };
  let sequence = 0;
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const result = { backend, storage, navigator, auth };
  const firebase = {
    app: { getApps: () => [], getApp: () => ({}), initializeApp: () => ({}) },
    auth: {
      getAuth: () => auth,
      browserLocalPersistence: {},
      setPersistence: async () => {},
      onAuthStateChanged: (_, callback) => { callbacks.push(callback); queueMicrotask(() => callback(auth.currentUser)); },
      getRedirectResult: async () => null,
      GoogleAuthProvider: class { setCustomParameters() {} },
      signOut: async () => result.login(null),
      signInWithPopup: async () => {},
      signInWithRedirect: async () => {},
    },
    firestore: {
      getFirestore: () => ({}),
      enableMultiTabIndexedDbPersistence: async () => {},
      doc: (_, ...parts) => ({ parts }),
      collection: (_, ...parts) => ({ parts }),
      FieldPath: class { constructor(...parts) { this.parts = parts; } },
      setDoc: (...args) => backend.write(result, ...args),
      runTransaction: async (_, callback) => {
        if (backend.beforeTransaction) {
          const before = backend.beforeTransaction;
          backend.beforeTransaction = null;
          before();
        }
        const staged = [];
        const returned = await callback({
          get: async reference => {
            const value = backend.documents.get(reference.parts[1] + '/' + reference.parts[3]);
            return { exists: () => Boolean(value), data: () => copy(value) };
          },
          set: (...args) => staged.push(args),
        });
        for (const args of staged) await backend.write(result, ...args);
        return returned;
      },
      onSnapshot: (reference, _, callback) => {
        const listener = { client: result, uid: reference.parts[1], callback };
        backend.listeners.add(listener);
        queueMicrotask(() => {
          if (backend.listeners.has(listener)) callback(backend.snapshot(listener.uid, !navigator.onLine));
        });
        return () => backend.listeners.delete(listener);
      },
      getDocs: async reference => ({
        docs: (backend.legacyDays.get(reference.parts.join('/')) || [])
          .map(record => ({ id: record.id, data: () => copy(record) })),
        metadata: { fromCache: !navigator.onLine },
      }),
    },
  };
  const window = {
    crypto: { randomUUID: () => 'client-' + result.number + '-operation-' + (++sequence) },
    SCHEDULE_FIREBASE_CONFIG: { apiKey: 'public', authDomain: 'example.test', projectId: 'test', appId: 'test' },
    addEventListener: (type, callback) => {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(callback);
    },
  };
  result.number = client.sequence = (client.sequence || 0) + 1;
  const context = vm.createContext({
    window, navigator, localStorage, console, __firebase: firebase,
    setTimeout: () => 0, clearTimeout: () => {}, queueMicrotask,
  });
  vm.runInContext(source, context, { filename: 'assistant-store.js' });
  result.store = window.HVFStore;
  result.emit = (event, value) => (events.get(event) || []).forEach(callback => callback(value));
  result.login = uid => {
    auth.currentUser = uid ? { uid, email: uid + '@example.test', displayName: uid } : null;
    callbacks.forEach(callback => callback(auth.currentUser));
  };
  result.start = async uid => {
    await result.store.init();
    await settle();
    result.store.setPeriod('2026-10', '2026-10-23');
    if (uid) result.login(uid);
    await settle();
    return result;
  };
  result.offline = () => { navigator.onLine = false; result.emit('offline'); };
  result.online = () => { navigator.onLine = true; backend.publish(); result.emit('online'); };
  result.records = () => copy(result.store.getState().records);
  return result;
}

const task = (id, title = id) => ({ id, kind: 'task', month: '2026-10', date: '2026-10-23', title, duration: 30 });

test('empty assistant stays empty and anonymous changes survive reload and deletion', async () => {
  const a = await client().start();
  assert.deepEqual(a.records(), {});
  a.store.put(task('personal'));
  const b = await client(a.backend, a.storage).start();
  assert.equal(b.records().personal.title, 'personal');
  b.store.remove('personal');
  const c = await client(a.backend, a.storage).start();
  assert.deepEqual(c.records(), {});
  assert.equal(a.backend.writes.length, 0);
});

test('anonymous data is claimed once and accounts remain isolated', async () => {
  const a = await client().start();
  a.store.put(task('draft'));
  a.login('alice'); await settle();
  assert.equal(a.records().draft.title, 'draft');
  assert.ok(a.backend.documents.get('alice/2026-10').assistantV2.draft);
  a.login(null); await settle();
  assert.deepEqual(a.records(), {});
  a.login('bob'); await settle();
  assert.deepEqual(a.records(), {});
  a.store.put(task('bob-private')); await settle();
  a.login('alice'); await settle();
  assert.ok(a.records().draft);
  assert.equal(a.records()['bob-private'], undefined);
});

test('two devices merge separate records and preserve existing monthly data', async () => {
  const backend = new Backend();
  backend.documents.set('alice/2026-10', { goals: [], existing: 'legacy' });
  const a = await client(backend).start('alice');
  const b = await client(backend).start('alice');
  a.store.put(task('a'));
  b.store.put({ id: 'b', kind: 'expense', month: '2026-10', amount: 200 });
  await settle();
  assert.deepEqual(Object.keys(a.records()).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(b.records()).sort(), ['a', 'b']);
  assert.equal(backend.documents.get('alice/2026-10').existing, 'legacy');
});

test('offline edits survive reload and upload after reconnect', async () => {
  const a = await client().start('alice');
  a.store.put(task('kept')); await settle();
  a.offline();
  a.store.remove('kept');
  a.store.put(task('later'));
  const b = client(a.backend, a.storage);
  b.offline(); await b.start('alice');
  assert.equal(b.records().kept, undefined);
  assert.ok(b.records().later);
  b.online(); await settle();
  assert.equal(a.backend.documents.get('alice/2026-10').assistantV2.kept.deleted, true);
  assert.ok(a.backend.documents.get('alice/2026-10').assistantV2.later.value);
});

test('a mutation during an unacknowledged write is sent after the first write', async () => {
  const a = await client().start('alice');
  a.backend.holdWrites = true;
  a.store.put(task('one', 'first'));
  a.store.put(task('one', 'second'));
  await settle();
  assert.equal(a.backend.held.length, 1);
  a.backend.releaseOne(); await settle();
  assert.equal(a.backend.held.length, 1);
  a.backend.releaseOne(); await settle();
  assert.equal(a.backend.documents.get('alice/2026-10').assistantV2.one.value.title, 'second');
  assert.equal(a.store.getState().status, 'synced');
});

test('an offline stale edit cannot resurrect a task deleted on another device', async () => {
  const backend = new Backend();
  const a = await client(backend).start('alice');
  const b = await client(backend).start('alice');
  a.store.put(task('shared')); await settle();
  a.offline();
  a.store.put(task('shared', 'offline edit'));
  b.store.remove('shared'); await settle();
  a.online(); await settle();
  assert.equal(a.records().shared, undefined);
  assert.equal(b.records().shared, undefined);
  assert.equal(backend.documents.get('alice/2026-10').assistantV2.shared.deleted, true);
});

test('a tombstone blocks repeat legacy import and built-in schedule completions are excluded', async () => {
  const backend = new Backend();
  backend.documents.set('alice/2026-10', {
    goals: [{ id: 'old', title: 'User goal' }], tasks: [],
    assistantV2: { 'legacy-goal-old': {
      id: 'legacy-goal-old', month: '2026-10', operation: 'deleted', updatedAt: 1, deleted: true,
    } },
  });
  backend.legacyDays.set('users/alice/days/2026-10-23/tasks', [
    { id: '__schedule_done__work', title: 'Built-in', duration: 480 },
    { id: 'mine', title: 'My own task', duration: 25 },
  ]);
  const a = await client(backend).start('alice');
  assert.deepEqual(Object.keys(a.records()), ['legacy-day-2026-10-23-mine']);
  assert.equal(a.records()['legacy-goal-old'], undefined);
  backend.publish(); await settle();
  assert.equal(a.records()['legacy-goal-old'], undefined);
});

test('account switching during an in-flight write never sends it to the new account', async () => {
  const a = await client().start('alice');
  a.backend.holdWrites = true;
  a.store.put(task('alice-only'));
  await settle();
  a.login('bob'); await settle();
  a.store.put(task('bob-only'));
  a.backend.releaseOne(); await settle();
  assert.equal(a.backend.held.length, 1);
  a.backend.releaseOne(); await settle();
  assert.equal(a.backend.documents.get('alice/2026-10').assistantV2['bob-only'], undefined);
  assert.equal(a.backend.documents.get('bob/2026-10').assistantV2['alice-only'], undefined);
  assert.deepEqual(Object.keys(a.records()), ['bob-only']);
});

test('a delete received inside the transaction blocks stale restoration', async () => {
  const a = await client().start('alice');
  a.store.put(task('race')); await settle();
  a.backend.beforeTransaction = () => {
    a.backend.documents.get('alice/2026-10').assistantV2.race = {
      id: 'race', month: '2026-10', operation: 'concurrent-delete', deleted: true, updatedAt: 1,
    };
  };
  a.store.put(task('race', 'stale update')); await settle();
  assert.equal(a.backend.documents.get('alice/2026-10').assistantV2.race.deleted, true);
  assert.equal(a.records().race, undefined);
});

test('an explicit restore after observing a tombstone is allowed', async () => {
  const a = await client().start('alice');
  a.store.put(task('restorable')); await settle();
  a.store.remove('restorable'); await settle();
  a.store.put(task('restorable', 'restored deliberately')); await settle();
  assert.equal(a.records().restorable.title, 'restored deliberately');
  assert.equal(a.backend.documents.get('alice/2026-10').assistantV2.restorable.deleted, false);
});

test('a delayed cross-tab storage event cannot replay an older acknowledged edit', async () => {
  const backend = new Backend();
  const sharedStorage = new Map();
  const a = await client(backend, sharedStorage).start('alice');
  const b = await client(backend, sharedStorage).start('alice');
  backend.holdWrites = true;
  a.store.put(task('shared-tab', 'first'));
  await settle();
  b.offline();
  b.emit('storage', { key: 'hvf-assistant-v2:alice' });
  assert.equal(b.records()['shared-tab'].title, 'first');
  backend.releaseOne(); await settle();
  a.store.put(task('shared-tab', 'second'));
  await settle();
  backend.releaseOne(); await settle();
  b.emit('storage', { key: 'hvf-assistant-v2:alice' });
  assert.equal(b.records()['shared-tab'].title, 'second');
  b.online(); await settle();
  assert.equal(backend.held.length, 0, 'an already acknowledged old edit is not queued again');
  assert.equal(backend.documents.get('alice/2026-10').assistantV2['shared-tab'].value.title, 'second');
});

test('income, fixed commitments and currencies sync as separate records between devices', async () => {
  const backend = new Backend();
  const desktop = await client(backend).start('alice');
  const phone = await client(backend).start('alice');
  desktop.store.put({ id: 'budget-2026-10-BYN', kind: 'budget', month: '2026-10', currency: 'BYN', income: 2000 });
  desktop.store.put({ id: 'tutors', kind: 'commitment', month: '2026-10', title: 'Tutors', amount: 680, currency: 'BYN' });
  phone.store.put({ id: 'gift', kind: 'income', month: '2026-10', date: '2026-10-23', title: 'Gift', amount: 100, currency: 'BYN' });
  phone.store.put({ id: 'freelance', kind: 'income', month: '2026-10', date: '2026-10-23', title: 'Freelance', amount: 45.67, currency: 'USD' });
  phone.store.put({ id: 'roubles', kind: 'income', month: '2026-10', date: '2026-10-23', title: 'Other', amount: 800, currency: 'RUB' });
  await settle();
  assert.deepEqual(desktop.records(), phone.records());
  assert.equal(desktop.records().gift.amount, 100);
  assert.equal(desktop.records().tutors.amount, 680);
  assert.equal(desktop.records().freelance.currency, 'USD');
  assert.equal(desktop.records().roubles.currency, 'RUB');

  desktop.store.put({ ...desktop.records()['budget-2026-10-BYN'], income: 2200 });
  phone.store.put({ ...phone.records().gift, amount: 150 });
  await settle();
  const reloadedPhone = await client(backend).start('alice');
  assert.deepEqual(reloadedPhone.records(), desktop.records());
  assert.equal(reloadedPhone.records()['budget-2026-10-BYN'].income, 2200);
  assert.equal(reloadedPhone.records().gift.amount, 150);
  assert.equal(reloadedPhone.records().tutors.amount, 680);
});

test('finance preferences and monthly records retain scope through offline replay and account changes', async () => {
  const backend = new Backend();
  const desktop = await client(backend).start('alice');
  const phone = await client(backend).start('alice');
  const preference = { id: 'finance-preferences', kind: 'preferences', month: '2000-01', currency: 'BYN' };
  desktop.store.put(preference);
  desktop.store.put({ id: 'budget-2026-10-BYN', kind: 'budget', month: '2026-10', currency: 'BYN', income: 2000 });
  await settle();
  phone.offline();
  phone.store.put({ ...preference, currency: 'USD' });
  phone.store.put({ id: 'budget-2026-11-BYN', kind: 'budget', month: '2026-11', currency: 'BYN', income: 2500 });
  phone.store.setPeriod('2026-11', '2026-11-01');
  assert.throws(() => phone.store.put({ ...phone.records()['budget-2026-10-BYN'], month: '2026-11' }), /новый id/);
  phone.online(); await settle();
  assert.equal(desktop.records()['finance-preferences'].currency, 'USD');
  assert.equal(desktop.records()['budget-2026-10-BYN'].income, 2000);
  assert.equal(desktop.records()['budget-2026-11-BYN'].income, 2500);
  assert.equal(backend.documents.get('alice/2000-01').assistantV2['finance-preferences'].value.currency, 'USD');

  phone.login('bob'); await settle();
  assert.deepEqual(phone.records(), {});
  phone.store.put({ ...preference, currency: 'RUB' }); await settle();
  phone.login('alice'); await settle();
  assert.equal(phone.records()['finance-preferences'].currency, 'USD');
  assert.equal(phone.records()['budget-2026-11-BYN'].income, 2500);
  assert.equal(backend.documents.get('bob/2000-01').assistantV2['finance-preferences'].value.currency, 'RUB');
});
