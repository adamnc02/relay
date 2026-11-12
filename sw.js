// Relay service worker.
// - Versioned cache: bump VERSION with any shell change; old caches are deleted on activate.
// - Same-origin GETs only, network-first, so a new deploy shows up on the next load
//   and the cached copy is used only when the network fails.
// - Cross-origin requests (Supabase API, Realtime, Google Fonts) are never intercepted
//   or cached. The offline copy of row data lives in localStorage, written by the app.
// - Push: 'push' shows the notification the relay-push Edge Function sent;
//   'notificationclick' opens the ticket (see the end of this file).
const VERSION = 'v6';
const CACHE = `relay-shell-${VERSION}`;
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

// Push. The payload is { title, body, tag, url } from the relay-push Edge
// Function. iOS requires every push to show a notification (a push handled
// without one counts against the site and can cost it the permission), so
// this always shows something, even for a payload it can't read.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title : 'Relay';
  e.waitUntil(self.registration.showNotification(title, {
    body: typeof d.body === 'string' ? d.body : 'A ticket is waiting for you.',
    tag: typeof d.tag === 'string' ? d.tag : undefined,
    icon: 'icon-192.png',
    data: { url: typeof d.url === 'string' ? d.url : self.registration.scope },
  }));
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
