// Agent offline shell: the page opens instantly (and shows "reconnecting") even without a connection.
const CACHE = 'sentinel-agent-v2';
const SHELL = ['./', './agent.js', './agent.css', '../shared/theme.css', '../shared/ui.js', '../shared/boot.js', '../shared/canonical.js', '../shared/missions.js', '../shared/link.js', '../vendor/peerjs.min.js', '../shared/logo.svg', '../shared/icons/icon-192.png'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first (always the newest code), cache as a fallback.
  e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match(new URL('./', self.registration.scope).href))));
});
