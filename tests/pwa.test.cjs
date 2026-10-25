const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { inflateSync } = require('node:zlib');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const pwaSource = fs.readFileSync(path.join(root, 'pwa.js'), 'utf8');
const SCOPE = 'https://example.github.io/daily-schedule/';
const turn = () => new Promise(resolve => setImmediate(resolve));

// Decode our non-interlaced RGB export using only Node built-ins. Checking the
// actual pixels catches an empty fallback image as well as transparent corners.
function readIconPng(file) {
  const png=fs.readFileSync(path.join(root,file));
  assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]),file+' is a PNG');
  const chunks=[];let header,transparency=false;
  for(let offset=8;offset<png.length;){
    const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+length);
    if(type==='IHDR')header=data;
    if(type==='IDAT')chunks.push(data);
    if(type==='tRNS')transparency=true;
    offset+=length+12;
  }
  assert.ok(header,file+' has image dimensions');
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4);
  assert.equal(header[8],8,file+' uses 8-bit color');
  assert.equal(header[9],2,file+' uses opaque RGB with no alpha channel');
  assert.equal(header[12],0,file+' is not interlaced');
  assert.equal(transparency,false,file+' has no transparent color key');
  const channels=3,stride=width*channels,raw=inflateSync(Buffer.concat(chunks)),pixels=Buffer.alloc(stride*height);
  assert.equal(raw.length,(stride+1)*height,file+' contains every scanline');
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4,file+' uses a standard PNG filter');
    for(let x=0;x<stride;x++){
      const index=y*stride+x,left=x>=channels?pixels[index-channels]:0,up=y?pixels[index-stride]:0,upperLeft=y&&x>=channels?pixels[index-stride-channels]:0;
      const prediction=filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,upperLeft):0;
      pixels[index]=(raw[y*(stride+1)+1+x]+prediction)&255;
    }
  }
  return {width,height,pixels,pixel:(x,y)=>[...pixels.subarray((y*width+x)*channels,(y*width+x)*channels+channels)]};
}

function worker(options = {}) {
  const scope = options.scope || SCOPE;
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
    registration: { scope, async showNotification(title, settings) { notifications.push({ title, settings }); } },
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
        request: { url: new URL(url, scope).href, mode: options.mode || 'cors', method: options.method || 'GET' },
        respondWith(value) { pending = value; }
      });
      return pending;
    }
  };
}

test('relative manifest supports both the old project path and the new root hosting', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], './');
  for (const scope of [SCOPE, 'https://hvf.example.workers.dev/']) {
    for (const field of ['id', 'scope', 'start_url']) assert.equal(new URL(manifest[field], scope).href, scope);
  }
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.equal(new URL(icon.src,SCOPE).search,'?v=2');
    assert.ok(fs.existsSync(path.join(root,new URL(icon.src,SCOPE).pathname.split('/').pop())));
  }
});

test('iPhone gets an explicit fresh 180px PNG and every install icon is an opaque branded square',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const link=html.match(/<link\b[^>]*rel="apple-touch-icon"[^>]*>/)?.[0];
  assert.ok(link,'an iOS touch icon is declared');
  assert.match(link,/href="\.\/apple-touch-icon-v2\.png"/);
  assert.match(link,/sizes="180x180"/);assert.match(link,/type="image\/png"/);
  for(const [file,size] of [['apple-touch-icon-v2.png',180],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]){
    const icon=readIconPng(file);assert.equal(icon.width,size);assert.equal(icon.height,size);
    for(const [x,y] of [[0,0],[size-1,0],[0,size-1],[size-1,size-1]])assert.deepEqual(icon.pixel(x,y),[24,61,54],file+' has a solid green square corner');
    let creamPixels=0;
    for(let i=0;i<icon.pixels.length;i+=3)if(icon.pixels[i]===242&&icon.pixels[i+1]===239&&icon.pixels[i+2]===223)creamPixels++;
    assert.ok(creamPixels>size*size*.15,file+' visibly contains the cream assistant logo');
  }
  assert.equal(fs.readFileSync(path.join(root,'apple-touch-icon.png')).compare(fs.readFileSync(path.join(root,'apple-touch-icon-v2.png'))),0,'the conventional fallback matches the fresh iOS icon');
});

test('Cloudflare serves precached HTML paths without canonical redirects that reject service worker installation', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'backend/app/wrangler.jsonc'), 'utf8'));
  assert.equal(config.assets.html_handling, 'none');
  assert.equal(config.assets.directory, '../../dist');
});

test('installation precaches a complete public shell under the project path only', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const urls = sw.requests.map(request => request.url);
  assert.equal(urls.length, 41);
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
  assert.match(workflow, /run: node scripts\/build-public\.mjs/);
  assert.doesNotMatch(workflow, /(?:configure|deploy|upload)-pages|pages:\s*write|id-token:\s*write|environment:\s*\n\s*name: github-pages/);
  assert.match(workflow, /backend\/billing\/worker\.mjs/);
  assert.match(workflow, /backend\/app\/worker\.mjs/);
  const build = fs.readFileSync(path.join(root, 'scripts/build-public.mjs'), 'utf8');
  assert.match(build, /service-worker\.js/);
  assert.match(build, /JSON\.parse\(match\[1\]\)/, 'public build reads the service worker allowlist');
  const output = path.join(root, 'dist');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'stale-build-check.txt'), 'must not be deployed');
  execFileSync(process.execPath, [path.join(root, 'scripts/build-public.mjs')], { cwd: root, stdio: 'pipe' });
  const copied = fs.readdirSync(output).sort();
  assert.deepEqual(copied, expected.concat('_headers').sort(), 'public build contains only shell files, worker and hosting headers');
  for (const file of expected) assert.equal(fs.readFileSync(path.join(output, file)).compare(fs.readFileSync(path.join(root, file))), 0, file + ' is copied intact');
  const validator = fs.readFileSync(path.join(root, 'generate.py'), 'utf8');
  const required = [...validator.match(/REQUIRED = \(([\s\S]*?)\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(required, expected, 'local validation covers the deployed files');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = html.indexOf('./assistant-ui.js');
  assert.ok(ui > 0);
  for (const name of ['categories', 'forecast', 'backup', 'focus', 'limits', 'navigation', 'motion', 'billing']) {
    const moduleIndex = html.indexOf('./assistant-' + name + '.js');
    assert.ok(moduleIndex > 0 && moduleIndex < ui, name + ' module loads before UI');
    assert.match(workflow, new RegExp('for file in [^\\n]*assistant-' + name + '\\.js'));
  }
  assert.ok(html.indexOf('./assistant-core.js') < html.indexOf('./assistant-forecast.js'), 'forecast uses the already loaded budget core');
  assert.ok(html.indexOf('./assistant-categories.js') < html.indexOf('./assistant-limits.js'), 'custom category limits load their classifier first');
  assert.ok(html.indexOf('./app-config.js') < html.indexOf('./firebase-config.js'), 'hosting and billing configuration is available before services initialize');
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+)(?:\?[^\"]*)?"/g)].map(match => match[1]);
  assert.equal(stylesheets.at(-1), './assistant-mobile.css', 'comfortable phone layouts override the older small typography');
  assert.ok(stylesheets.indexOf('./assistant-membership.css') < stylesheets.indexOf('./assistant-motion.css'));
  assert.ok(stylesheets.indexOf('./assistant-motion.css') < stylesheets.indexOf('./assistant-onboarding.css'));
  assert.ok(stylesheets.indexOf('./assistant-onboarding.css') < stylesheets.indexOf('./assistant-mobile.css'));
  for (const source of [html, workerSource, workflow, validator]) assert.doesNotMatch(source, /assistant-(?:ai|quick)\.js/);
});

test('root hosting keeps offline files, notification icons and reminder routes on the new origin', async () => {
  const scope = 'https://hvf.example.workers.dev/';
  const sw = worker({ scope });
  await sw.lifecycle('install');
  assert.equal(sw.requests.length, 41);
  assert.ok(sw.requests.every(request => request.url.startsWith(scope)));
  sw.setNetwork(async () => { throw new Error('offline'); });
  assert.match(await (await sw.fetch('./', { mode: 'navigate' })).text(), /online:/);
  assert.match(await (await sw.fetch('assistant-mobile.css?v=1')).text(), /online:/);
  assert.match(await (await sw.fetch('apple-touch-icon-v2.png')).text(), /online:/);
  assert.match(await (await sw.fetch('icon-192.png?v=2')).text(), /online:/);
  await sw.dispatch('push', { data: { json: () => ({ date: '2026-10-25' }) } });
  assert.equal(sw.notifications[0].settings.icon, scope + 'icon-192.png');
  await sw.dispatch('notificationclick', { notification: { data: { date: '2026-10-25' }, close() {} } });
  assert.deepEqual(sw.opened, [scope + '#day/2026-10-25']);
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
