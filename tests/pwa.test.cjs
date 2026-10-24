const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const pwaSource = fs.readFileSync(path.join(root, 'pwa.js'), 'utf8');
const SCOPE = 'https://example.github.io/daily-schedule/';
const turn = () => new Promise(resolve => setImmediate(resolve));

function worker(options = {}) {
  const events = new Map();
  const stores = new Map();
  const requests = [];
  const notifications = [], opened = [];
  let network = async request => new Response('online:' + request.url);
  let claims = 0;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(items) {
          // Model Cache.addAll's all-or-nothing behavior.
          const responses = await Promise.all(items.map(async request => {
            const response = await fetchMock(request);
            if (!response.ok) throw new Error('Precache failed');
            return response;
          }));
          items.forEach((request, index) => entries.set(request.url, responses[index]));
        },
        async put(key, response) { entries.set(typeof key === 'string' ? key : key.url, response); },
        async match(key) {
          const value = entries.get(typeof key === 'string' ? key : key.url);
          return value && value.clone();
        }
      };
    }
  };
  const fetchMock = async request => { requests.push(request); return network(request); };
  const self = {
    registration: { scope: SCOPE, async showNotification(title, settings) { notifications.push({ title, settings }); } },
    clients: { async claim() { claims++; }, async matchAll() { return options.windows || []; }, async openWindow(url) { opened.push(url); } },
    addEventListener: (name, callback) => events.set(name, callback)
  };
  vm.runInNewContext(workerSource, { self, URL, Request, Response, Set, caches, fetch: fetchMock });
  return {
    stores, requests, caches, notifications, opened,
    get claims() { return claims; },
    setNetwork(value) { network = value; },
    async dispatch(name, data) {
      let pending;
      events.get(name)({ ...data, waitUntil(value) { pending = value; } });
      await pending;
    },
    async lifecycle(name) {
      let pending;
      events.get(name)({ waitUntil(value) { pending = value; } });
      return pending;
    },
    fetch(url, options = {}) {
      let pending;
      events.get('fetch')({
        request: { url: new URL(url, SCOPE).href, mode: options.mode || 'cors', method: options.method || 'GET' },
        respondWith(value) { pending = value; }
      });
      return pending;
    }
  };
}

test('manifest keeps installation within the GitHub Pages project path', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], './');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)));
});

test('installation precaches a complete public shell under the project path only', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const urls = sw.requests.map(request => request.url);
  assert.equal(urls.length, 29);
  for (const request of sw.requests) {
    assert.ok(request.url.startsWith(SCOPE));
    assert.equal(request.cache, 'reload');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.ok(fs.existsSync(path.join(root, new URL(request.url).pathname.split('/').pop())));
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)(?:\?[^"#]+)?"/g)) {
    assert.ok(urls.includes(new URL(match[1], SCOPE).href), 'offline shell includes ' + match[1]);
  }
  assert.ok(!urls.some(url => /firebasejs|firestore|accounts|huggingface/.test(url)));
});

test('deployment and validation include the same shell and load the new modules before the UI', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const expected = sw.requests.map(request => new URL(request.url).pathname.split('/').pop()).concat('service-worker.js').sort();
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/update_schedule.yml'), 'utf8');
  const copied = workflow.match(/\bcp (index\.html [^\n]+) _site\//)[1].trim().split(/\s+/).sort();
  assert.deepEqual(copied, expected, 'GitHub Pages artifact includes every public shell file');
  const validator = fs.readFileSync(path.join(root, 'generate.py'), 'utf8');
  const required = [...validator.match(/REQUIRED = \(([\s\S]*?)\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(required, expected, 'local validation covers the deployed files');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = html.indexOf('./assistant-ui.js?v=8');
  assert.ok(ui > 0);
  for (const name of ['categories', 'forecast', 'backup', 'focus', 'limits']) {
    const moduleIndex = html.indexOf('./assistant-' + name + '.js');
    assert.ok(moduleIndex > 0 && moduleIndex < ui, name + ' module loads before UI');
    assert.match(workflow, new RegExp('for file in [^\\n]*assistant-' + name + '\\.js'));
  }
  assert.ok(html.indexOf('./assistant-core.js') < html.indexOf('./assistant-forecast.js'), 'forecast uses the already loaded budget core');
  assert.ok(html.indexOf('./assistant-categories.js') < html.indexOf('./assistant-limits.js'), 'custom category limits load their classifier first');
  for (const source of [html, workerSource, workflow, validator]) assert.doesNotMatch(source, /assistant-(?:ai|quick)\.js/);
});

test('a missing shell file rejects installation instead of activating a partial version', async () => {
  const sw = worker();
  sw.setNetwork(async request => new Response('body', { status: request.url.endsWith('assistant-ui.js') ? 404 : 200 }));
  await assert.rejects(sw.lifecycle('install'), /Precache failed/);
  assert.equal([...sw.stores.values()][0].size, 0);
});

test('activation removes only old cache versions belonging to this application scope', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.stores.set('hvf-shell:/daily-schedule/:old', new Map());
  sw.stores.set('hvf-shell:/other-app/:old', new Map());
  sw.stores.set('other-data', new Map());
  await sw.lifecycle('activate');
  assert.ok(!sw.stores.has('hvf-shell:/daily-schedule/:old'));
  assert.ok(sw.stores.has('hvf-shell:/other-app/:old'));
  assert.ok(sw.stores.has('other-data'));
  assert.equal(sw.claims, 1);
});

test('root and index navigations fetch new HTML first and use the shell when offline', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.setNetwork(async () => new Response('new HTML'));
  assert.equal(await (await sw.fetch('./', { mode: 'navigate' })).text(), 'new HTML');
  sw.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await sw.fetch('index.html', { mode: 'navigate' })).text(), 'new HTML');
  assert.equal(await (await sw.fetch('./', { mode: 'navigate' })).text(), 'new HTML');
});

test('versioned static assets update on the network and fall back to the same cached file', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.setNetwork(async () => new Response('new JS'));
  assert.equal(await (await sw.fetch('assistant-ui.js?v=4')).text(), 'new JS');
  sw.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await sw.fetch('assistant-ui.js?v=4')).text(), 'new JS');
});

test('remote services, auth callbacks, sensitive queries and unknown routes bypass the worker', () => {
  const sw = worker();
  const cases = [
    ['https://firestore.googleapis.com/v1/projects/private', {}],
    ['https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js', {}],
    ['https://example.github.io/other-app/index.html', { mode: 'navigate' }],
    ['__/auth/handler?state=private', { mode: 'navigate' }],
    ['./?code=private', { mode: 'navigate' }],
    ['index.html?token=private', { mode: 'navigate' }],
    ['money/export.json', {}],
    ['missing', { mode: 'navigate' }],
    ['assistant-ui.js?token=private', {}],
    ['assistant-ui.js?v=4&user=private', {}],
    ['assistant-ui.js', { method: 'POST' }]
  ];
  for (const [url, options] of cases) assert.equal(sw.fetch(url, options), undefined, url);
  assert.equal(sw.requests.length, 0);
});

test('server outages use the public shell but redirects and ordinary HTTP errors are not cached', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.setNetwork(async () => new Response('outage', { status: 503 }));
  assert.match(await (await sw.fetch('./', { mode: 'navigate' })).text(), /online:/);
  sw.setNetwork(async () => new Response('missing', { status: 404 }));
  assert.equal((await sw.fetch('./', { mode: 'navigate' })).status, 404);
  sw.setNetwork(async () => ({ ok: true, type: 'basic', redirected: true, status: 200, text: async () => 'auth redirect' }));
  assert.equal(await (await sw.fetch('./', { mode: 'navigate' })).text(), 'auth redirect');
  sw.setNetwork(async () => { throw new Error('offline'); });
  assert.match(await (await sw.fetch('./', { mode: 'navigate' })).text(), /online:/);
});

test('cache storage failure does not block online responses', async () => {
  const sw = worker();
  sw.caches.open = async () => { throw new Error('unavailable'); };
  assert.match(await (await sw.fetch('./', { mode: 'navigate' })).text(), /online:/);
});

test('a push always displays a visible notification and ignores remote navigation URLs', async () => {
  const sw = worker();
  await sw.dispatch('push', { data: { json: () => ({ title: 'HVF', body: '18:00 · Урок', date: '2026-10-24', tag: 'lesson', url: 'https://evil.example/' }) } });
  assert.equal(sw.notifications.length, 1);
  const notification = sw.notifications[0];
  assert.equal(notification.settings.body, '18:00 · Урок');
  assert.equal(notification.settings.icon, SCOPE + 'icon-192.png');
  let closed = false;
  await sw.dispatch('notificationclick', { notification: { ...notification.settings, close() { closed = true; } } });
  assert.equal(closed, true);
  assert.deepEqual(sw.opened, [SCOPE + '#day/2026-10-24']);
});

test('a notification focuses an existing app without reloading its unfinished form', async () => {
  const messages = [];
  let focuses = 0;
  const sw = worker({ windows: [
    { url: 'https://example.github.io/another-project/', focus() { throw new Error('Wrong app'); } },
    { url: SCOPE + '#money', postMessage(data) { messages.push(data); }, async focus() { focuses++; } }
  ] });
  await sw.dispatch('notificationclick', { notification: { data: { date: '2026-10-24' }, close() {} } });
  assert.equal(focuses, 1);
  assert.equal(messages[0].type, 'HVF_OPEN_REMINDER');
  assert.equal(messages[0].date, '2026-10-24');
  assert.equal(sw.opened.length, 0);
});

test('invalid push data still creates a safe visible fallback notification', async () => {
  const sw = worker();
  await sw.dispatch('push', { data: { json() { throw new Error('Malformed JSON'); } } });
  assert.equal(sw.notifications.length, 1);
  assert.match(sw.notifications[0].title, /HVF/);
  assert.match(sw.notifications[0].settings.body, /Открой HVF/);
  await sw.dispatch('notificationclick', { notification: { data: { date: 'https://evil.example' }, close() {} } });
  assert.deepEqual(sw.opened, [SCOPE + '#day']);
});

function client(options = {}) {
  const events = new Map();
  const dispatched = [];
  const calls = [];
  const registrationEvents = new Map();
  const registration = {
    waiting: options.waiting || null,
    addEventListener(name, callback) { registrationEvents.set(name, callback); },
    async update() { calls.push('update'); }
  };
  const navigator = {
    userAgent: options.userAgent || 'Chrome', maxTouchPoints: options.maxTouchPoints || 0,
    standalone: options.standalone || false,
    serviceWorker: options.unsupported ? undefined : {
      controller: options.controller || null,
      ready: Promise.resolve(registration),
      async register(url, settings) {
        calls.push({ url, settings });
        if (options.registrationFails) throw new Error('registration failed');
        return registration;
      }
    }
  };
  const window = {
    isSecureContext: !options.insecure,
    matchMedia: () => ({ matches: options.standalone || false }),
    addEventListener(name, callback) { events.set(name, callback); },
    dispatchEvent(event) { dispatched.push(event); }
  };
  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  vm.runInNewContext(pwaSource, { window, navigator, CustomEvent, document: { readyState: 'loading' } });
  return { window, events, dispatched, calls, registration, registrationEvents, api: window.HVFPWA };
}

test('PWA registration uses a relative scope and never prompts or reloads on load', async () => {
  const page = client();
  assert.equal(page.calls.length, 0);
  await page.events.get('load')();
  await turn();
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].url, './service-worker.js?v=reminders-1');
  assert.equal(page.calls[0].settings.scope, './');
  assert.equal(page.calls[0].settings.updateViaCache, 'none');
  assert.equal(page.api.getStatus().offlineReady, true);
  assert.ok(page.dispatched.every(event => event.type === 'hvf-pwa-status'));
  assert.equal(await page.api.checkForUpdate(), true);
  assert.equal(page.calls[1], 'update');
});

test('only an explicit install action consumes the browser install event', async () => {
  const page = client();
  let prompts = 0;
  let prevented = false;
  page.events.get('beforeinstallprompt')({
    preventDefault() { prevented = true; },
    async prompt() { prompts++; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  assert.equal(prevented, true);
  assert.equal(prompts, 0);
  assert.equal(page.api.getStatus().canInstall, true);
  assert.equal((await page.api.requestInstall()).outcome, 'accepted');
  assert.equal(prompts, 1);
  assert.equal(page.api.getStatus().canInstall, false);
  assert.equal((await page.api.requestInstall()).outcome, 'unavailable');
  page.events.get('appinstalled')();
  assert.equal(page.api.getStatus().installed, true);
  assert.equal((await page.api.requestInstall()).outcome, 'installed');
});

test('iPhone and iPad have manual Safari instructions without a fake install prompt', async () => {
  for (const options of [{ userAgent: 'iPhone' }, { userAgent: 'Macintosh', maxTouchPoints: 5 }]) {
    const page = client(options);
    assert.match(page.api.getInstallInstructions().steps.join(' '), /Safari/);
    assert.match(page.api.getInstallInstructions().steps.join(' '), /На экран Домой/);
    assert.equal((await page.api.requestInstall()).outcome, 'unavailable');
  }
});

test('unsupported and failed registration leave ordinary app use available', async () => {
  for (const options of [{ unsupported: true }, { insecure: true }]) {
    const page = client(options);
    await page.events.get('load')();
    assert.equal(page.calls.length, 0);
    assert.equal(page.api.getStatus().supported, false);
    assert.equal(page.api.getStatus().error, '');
  }
  const page = client({ registrationFails: true });
  await page.events.get('load')();
  assert.equal(page.api.getStatus().offlineReady, false);
  assert.match(page.api.getStatus().error, /При подключении приложение продолжает работать/);
});

test('an available update is reported without replacing an open form', async () => {
  const page = client({ waiting: {} });
  await page.events.get('load')();
  assert.equal(page.api.getStatus().updateReady, true);
  assert.equal(page.calls.length, 1);
  const snapshot = page.api.getStatus();
  snapshot.updateReady = false;
  assert.equal(page.api.getStatus().updateReady, true, 'status snapshots cannot mutate state');
});
