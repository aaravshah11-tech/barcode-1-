// Shelf service worker: offline app shell + cached cover images.
// Bump VERSION whenever you change any app file so phones pick up the update.
const VERSION = 'shelf-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/isbn.js',
  'js/lookup.js',
  'js/db.js',
  'js/store.js',
  'js/scanner.js',
  'js/backup.js',
  'js/feedback.js',
  'js/pending.js',
  'js/sync/relay-link.js',
  'js/components/location-picker.js',
  'js/components/book-form.js',
  'js/views/library.js',
  'js/views/scan.js',
  'js/views/book.js',
  'js/views/stats.js',
  'js/views/settings.js',
  'js/views/link.js',
  'vendor/html5-qrcode.min.js',
  'vendor/mqtt.min.js',
  'vendor/qrcode.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const COVERS = 'shelf-covers';
const COVER_HOSTS = ['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com', 'archive.org'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== COVERS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: answer instantly from cache, refresh the cache in the background
  // (so a new deploy shows up on the next launch even if VERSION wasn't bumped).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const key = req.mode === 'navigate' ? 'index.html' : req;
        const hit = await cache.match(key, { ignoreSearch: true });
        const net = fetch(req).then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        });
        if (hit) {
          event.waitUntil(net.catch(() => {}));
          return hit;
        }
        return net.catch(() => Response.error());
      }),
    );
    return;
  }

  // Cover images: serve from cache, refresh in the background.
  if (req.destination === 'image' || COVER_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(COVERS).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
          return res;
        }).catch(() => hit || Response.error());
        return hit || net;
      }),
    );
  }
  // Everything else (book lookups, linking) goes straight to the network.
});
