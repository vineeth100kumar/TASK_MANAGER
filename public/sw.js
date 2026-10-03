// Sage service worker: shows the notifications the Pi pushes (reminders,
// morning plan, evening check-in) and opens the right item when one is tapped.
// It deliberately caches nothing, so every visit loads the current app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Sage', body: event.data ? event.data.text() : '' }; }
  const itemId = data.itemId || (data.url && new URLSearchParams(new URL(data.url, self.location.origin).search).get('open'));
  const actions = itemId ? [
    { action: 'done', title: '✓ Done' },
    { action: 'snooze', title: '💤 Snooze' },
    { action: 'tomorrow', title: '→ Tomorrow' },
  ] : [];
  event.waitUntil(
    self.registration.showNotification(data.title || 'Sage', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/', itemId },
      actions,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, itemId } = event.notification.data || {};
  const action = event.action;

  if (action && itemId) {
    event.waitUntil((async () => {
      try {
        const resp = await fetch(`/api/items/${encodeURIComponent(itemId)}/${action}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'notification' }),
        });
        if (!resp.ok) throw new Error(resp.statusText);
      } catch (e) {
        // API failed — fall through to open the app so the user can act manually.
        const target = new URL(url || '/', self.location.origin);
        await self.clients.openWindow(target.href);
      }
    })());
    return;
  }

  const target = new URL(url || '/', self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      const id = target.searchParams.get('open');
      if (id) open.postMessage({ type: 'sage-open-item', id });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// The browser can rotate a subscription. Hand the new one to the Pi so
// notifications keep arriving without the person doing anything.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const fresh = event.newSubscription || (old && await self.registration.pushManager.subscribe(old.options));
    if (!fresh) return;
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: fresh.toJSON(), label: 'This device' }),
    }).catch(() => {});
    if (old) {
      await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: old.endpoint }),
      }).catch(() => {});
    }
  })());
});
