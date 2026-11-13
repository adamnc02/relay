// Relay service worker.
// - Versioned cache: bump VERSION with any shell change; old caches are deleted on activate.
// - Same-origin GETs only, network-first, so a new deploy shows up on the next load
//   and the cached copy is used only when the network fails.
// - Google Fonts (IBM Plex) is cached in its own cache so the fonts work offline:
//   the stylesheet network-first, the font files cache-first (their URLs are versioned).
//   Every other cross-origin request (Supabase API, Realtime) is never intercepted or
//   cached. The offline copy of row data lives in localStorage, written by the app.
// - Push: 'push' shows the notification the relay-push Edge Function sent;
//   'notificationclick' opens the ticket (see the end of this file).
// - 'relay:version' message: replies with VERSION, which the rail shows.
const VERSION = 'v10';
const CACHE = `relay-shell-${VERSION}`;
const FONT_CACHE = 'relay-fonts';
const FONT_CSS = 'https://fonts.googleapis.com';
const FONT_FILES = 'https://fonts.gstatic.com';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/config.js',
  './js/model.js',
  './js/markdown.js',
  './js/icons.js',
  './js/store.js',
  './js/push.js',
  './js/data/index.js',
  './js/data/demo.js',
  './js/data/sample.js',
  './js/data/supabase.js',
  './vendor/supabase-js-2.116.0.umd.js',
  './icon.svg',
  './favicon.svg',
  './favicon-32.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('relay-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === FONT_CSS || url.origin === FONT_FILES) { e.respondWith(font(req, url.origin === FONT_FILES)); return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? './index.html' : req, copy));
        }
        return res;
      })
      .catch(async () => {
        const c = await caches.open(CACHE);
        if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
        return (await c.match(req, { ignoreSearch: true })) || Response.error();
      }),
  );
});

// Only CORS responses are stored (the stylesheet link and font loads are CORS requests),
// never opaque ones. A failure with nothing cached fails the request as the network would.
async function font(req, cacheFirst) {
  const c = await caches.open(FONT_CACHE);
  if (cacheFirst) {
    const hit = await c.match(req);
    if (hit) return hit;
  }
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'cors') c.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

// Push. The payload is { title, body, tag, url } from the relay-push Edge
// Function. iOS requires every push to show a notification (a push handled
// without one counts against the site and can cost it the permission), so
// this always shows something, even for a payload it can't read.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title : 'Relay';
  const body = typeof d.body === 'string' ? d.body : 'A ticket is waiting for you.';
  const url = insideScope(d.url);
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body,
      tag: typeof d.tag === 'string' ? d.tag : undefined,
      icon: 'icon-192.png',
      data: { url },
    }),
    tellWindows({ title, body, url }),
  ]));
});

// iOS doesn't deliver 'notificationclick' for a tap while Relay is in front,
// so every push is also handed to the page, which shows its own banner: as a
// Cache Storage note the page polls, and by postMessage to every Relay window.
// The page decides whether it was in front when the push arrived (it compares
// the note's time with when it last came to the front); the worker doesn't,
// because iOS doesn't report the Home Screen app's window as visible here.
const PUSH_NOTE_CACHE = 'relay-push-note';
async function tellWindows(p) {
  try {
    const scope = self.registration.scope;
    const msg = { type: 'relay:push', ...p, at: Date.now() };
    const c = await caches.open(PUSH_NOTE_CACHE);
    await c.put(new URL('__push-note', scope).href,
      new Response(JSON.stringify(msg), { headers: { 'Content-Type': 'application/json' } }));
    (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((w) => w.url.startsWith(scope))
      .forEach((w) => w.postMessage(msg));
  } catch { /* the notification is still shown */ }
}

function insideScope(u) {
  const scope = self.registration.scope;
  try {
    const href = new URL(typeof u === 'string' && u ? u : scope, scope).href;
    return href.startsWith(scope) ? href : scope;
  } catch { return scope; }
}

self.addEventListener('message', (e) => {
  if (e.data?.type === 'relay:version') e.ports[0]?.postMessage({ version: VERSION });
});

// A tap opens the ticket: the URL carries ?t=<display key>. An open Relay
// window is focused and told the URL by postMessage; otherwise a new window
// opens at the URL. The URL is also written to Cache Storage, which the page
// reads on start and whenever it comes to the front, because on iOS a tap can
// reach the page with neither the URL nor the message.
const OPEN_NOTE_CACHE = 'relay-open-intent';
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const scope = self.registration.scope;
  let target;
  try { target = new URL(e.notification.data?.url || scope, scope); } catch { target = new URL(scope); }
  // Only ever somewhere inside Relay.
  const url = target.href.startsWith(scope) ? target.href : scope;

  const note = caches.open(OPEN_NOTE_CACHE)
    .then((c) => c.put(new URL('__open-intent', scope).href,
      new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } })))
    .catch(() => {});

  e.waitUntil(note
    .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .then((windows) => {
      const w = windows.find((c) => c.url.startsWith(scope));
      if (w) {
        w.postMessage({ type: 'relay:open', url });
        return w.focus();
      }
      return self.clients.openWindow(url);
    }));
});
