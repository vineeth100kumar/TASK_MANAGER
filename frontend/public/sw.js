/*
 * Sage service worker.
 *
 * The app installs to the home screen (display: standalone), so it has to open
 * to something when the Pi is unreachable — before this, it opened to a blank
 * page. Deliberately hand-written and dependency-free: this runs on a
 * Raspberry Pi 5 and does not need a caching framework to do three things.
 *
 * Strategy:
 *   - /api and /ws            never touched. Data is always live or absent.
 *   - hashed build assets     cache first. The filename changes when the
 *                             content does, so a hit is always correct.
 *   - navigations             network first, falling back to the cached shell,
 *                             so a deploy on the Pi is picked up immediately
 *                             but a dead Pi still opens the app.
 */

const VERSION = 'sage-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['/', '/index.html', '/manifest.json']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live data is never cached — a stale balance is worse than no balance.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  // The app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // Build output: /assets/index-<hash>.js. The hash makes a cache hit safe.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
      )
    );
  }
});
