/* Only the public application shell belongs in this cache. Account data,
 * Firebase requests, AI downloads, auth callbacks and arbitrary URLs do not. */
"use strict";

const SHELL_VERSION = "2026-10-24-3";
const SCOPE_URL = new URL("./", self.registration.scope);
const CACHE_PREFIX = "hvf-shell:" + SCOPE_URL.pathname + ":";
const CACHE_NAME = CACHE_PREFIX + SHELL_VERSION;
const SHELL_FILES = [
  "index.html", "assistant.css", "assistant-finance.css", "assistant-planner.css", "assistant-reminders.css", "firebase-config.js",
  "assistant-core.js", "assistant-store.js", "assistant-ai.js", "assistant-extras.js",
  "assistant-planner.js", "assistant-weekly.js", "assistant-ui.js", "reminders-config.js", "assistant-reminders.js", "pwa.js", "manifest.webmanifest", "favicon.svg",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png"
];
const SHELL_URLS = new Set(SHELL_FILES.map(file => new URL(file, SCOPE_URL).href));
const INDEX_URL = new URL("index.html", SCOPE_URL).href;

function isPublicResponse(response) {
  return response && response.ok && response.type !== "opaque" && !response.redirected;
}

self.addEventListener("install", event => {
  // A partial shell must never replace a usable offline copy. Cache.addAll
  // is atomic: a missing public file leaves this worker uninstalled.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    [...SHELL_URLS].map(url => new Request(url, { cache: "reload", credentials: "omit", redirect: "error" }))
  )));
  // An update waits until open tabs close; never reload an unsaved editor.
});

// Push is delivered by the external reminder service, including while HVF is
// closed. Every received message produces a visible notification on iPhone.
self.addEventListener("push", event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch (_) { /* Show a safe fallback. */ }
  if (!message || typeof message !== "object") message = {};
  const title = typeof message.title === "string" ? message.title.slice(0, 120) : "HVF · Напоминание";
  const body = typeof message.body === "string" ? message.body.slice(0, 300) : "Открой HVF, чтобы посмотреть свои дела.";
  const date = typeof message.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(message.date) ? message.date : "";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: new URL("icon-192.png", SCOPE_URL).href,
    tag: typeof message.tag === "string" ? message.tag.slice(0, 200) : "hvf-reminder",
    data: { date }, renotify: false
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const date = event.notification.data && event.notification.data.date;
  const target = new URL(SCOPE_URL.href);
  target.hash = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? "day/" + date : "day";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      let url;
      try { url = new URL(client.url); } catch (_) { continue; }
      if (url.origin !== SCOPE_URL.origin || (url.pathname !== SCOPE_URL.pathname && url.pathname !== new URL(INDEX_URL).pathname)) continue;
      // A message opens the day without reloading an unfinished editor.
      client.postMessage({ type: "HVF_OPEN_REMINDER", date });
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheKey) {
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch (_) { /* Online use does not require Cache Storage. */ }
  try {
    const response = await fetch(request);
    if (isPublicResponse(response)) {
      // Cache failures (for example quota limits) must not break online use.
      try { if (cache) await cache.put(cacheKey, response.clone()); } catch (_) { /* Online response remains usable. */ }
      return response;
    }
    // A hosting outage can use the existing static copy; an auth redirect
    // is never cached and is returned as delivered by the network.
    if (response.status >= 500) {
      const offline = cache && await cache.match(cacheKey);
      if (offline) return offline;
    }
    return response;
  } catch (error) {
    const offline = cache && await cache.match(cacheKey);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_URL.pathname)) return;

  if (request.mode === "navigate") {
    // Routes are hash based. Query-bearing/auth URLs and unknown paths must
    // reach the network unchanged, even when offline.
    if (url.search || (url.href !== SCOPE_URL.href && url.href !== INDEX_URL)) return;
    event.respondWith(networkFirst(request, INDEX_URL));
    return;
  }

  const canonical = new URL(url.href);
  canonical.search = "";
  canonical.hash = "";
  if (!SHELL_URLS.has(canonical.href)) return;
  // Allow only the app's explicit asset version parameter. Never cache a
  // request carrying user data, even when it uses an otherwise static path.
  if (url.search && !/^\?v=[A-Za-z0-9._-]+$/.test(url.search)) return;
  event.respondWith(networkFirst(request, canonical.href));
});
