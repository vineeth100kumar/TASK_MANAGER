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
 *   - push                    shown as a notification, and tapping one brings
 *                             the open app forward rather than opening a
 *                             second copy of it.
 */

const VERSION = 'sage-v3';
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
  // Fonts ship with the app and never change without a new filename, so they
  // are cached the same way — the typeface is fetched once, then never again.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/')
  ) {
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

/*
 * A reminder arrives.
 *
 * Without this handler the Pi's push reaches the device and nothing happens:
 * the browser wakes the worker, finds no listener, and in Chrome posts its own
 * "This site has been updated in the background" instead. So a reminder was
 * only ever visible if the app already happened to be open.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // A push with a plain-text body rather than JSON. Show it as the message.
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Sage';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    // Reminders for the same item replace one another rather than stacking up
    // on the lock screen, which is what happens when the Pi retries.
    tag: (payload.data && payload.data.tag) || 'sage-reminder',
    renotify: true,
    data: { url: (payload.data && payload.data.url) || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/*
 * Tapping one. If the app is already open somewhere, bring that window forward
 * and tell it where to go, rather than opening a second copy of the app.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: target });
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
