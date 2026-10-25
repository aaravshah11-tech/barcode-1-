// Command Centre service worker: shows SENTINEL alerts on this device. It caches nothing.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SENTINEL', {
    body: d.body || '',
    tag: d.tag || 'sentinel',
    renotify: true,
    requireInteraction: d.level === 'alert',
    icon: '/shared/icons/icon-192.png',
    badge: '/shared/icons/icon-192.png',
    data: { url: d.url || '/' },
    vibrate: d.level === 'alert' ? [200, 100, 200, 100, 400] : [120],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname === '/');
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
