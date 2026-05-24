/* Ubuntu 3.0 — Service Worker
 * App-shell caching for offline use.
 */
const CACHE = 'ubuntu30-v0.3.7-dev.13';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './db.js',
  './i18n.js',
  './api.js',
  './sync.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;
  // Never cache the API — sync needs live data
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      }).catch(() => {
        // Offline fallback: serve the app shell for navigation requests
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
