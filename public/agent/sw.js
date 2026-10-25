// Agent offline shell: the page opens instantly (and shows "reconnecting") even if HQ is restarting.
const CACHE = 'sentinel-agent-v1';
const SHELL = ['/agent/', '/agent/agent.js', '/agent/agent.css', '/shared/theme.css', '/shared/ui.js', '/shared/boot.js', '/shared/canonical.js', '/shared/missions.js', '/shared/logo.svg', '/shared/icons/icon-192.png'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (always the newest code from HQ), cache as a fallback.
  e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/agent/'))));
});
