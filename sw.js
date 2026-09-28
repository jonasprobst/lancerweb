// Offline support: always try the network, fall back to the cached copy.
const CACHE = 'bulkhead-v2';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/ui.js', 'js/engine.js', 'js/ai.js', 'js/missions.js',
  'js/data.js', 'js/hex.js', 'js/rng.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Network first so new versions show up right away; cache only when offline.
  e.respondWith(
    caches.open(CACHE).then((c) =>
      fetch(e.request)
        .then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })
        .catch(() => c.match(e.request, { ignoreSearch: true }))),
  );
});
