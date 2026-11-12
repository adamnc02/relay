// Relay service worker.
// - Versioned cache: bump VERSION with any shell change; old caches are deleted on activate.
// - Same-origin GETs only, network-first, so a new deploy shows up on the next load
//   and the cached copy is used only when the network fails.
// - Cross-origin requests (Supabase API, Realtime, Google Fonts) are never intercepted
//   or cached. The offline copy of row data lives in localStorage, written by the app.
const VERSION = 'v2';
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

// Push notifications (a later phase): add 'push' and 'notificationclick' handlers here.
