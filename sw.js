// HomeBase service worker: whole app available offline + cached cover/product images.
// The file list and VERSION are updated by: npm run sw
const VERSION = 'homebase-fc7086ff4307';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'css/tools.css',
  'js/app.js',
  'js/core/charts.js',
  'js/core/csv.js',
  'js/core/db.js',
  'js/core/feedback.js',
  'js/core/locations.js',
  'js/core/migrate.js',
  'js/core/people.js',
  'js/core/scanner.js',
  'js/core/store.js',
  'js/core/ui.js',
  'js/settings/backup.js',
  'js/settings/index.js',
  'js/settings/locations.js',
  'js/settings/pair.js',
  'js/settings/teams.js',
  'js/sync/manager.js',
  'js/sync/relay.js',
  'js/sync/supabase.js',
  'js/tools/golf/analysis.js',
  'js/tools/golf/golfers.js',
  'js/tools/golf/index.js',
  'js/tools/golf/record.js',
  'js/tools/golf/sensors.js',
  'js/tools/golf/views.js',
  'js/tools/inventory/add.js',
  'js/tools/inventory/data.js',
  'js/tools/inventory/form.js',
  'js/tools/inventory/index.js',
  'js/tools/inventory/labels.js',
  'js/tools/inventory/lookup.js',
  'js/tools/inventory/views.js',
  'js/tools/library/book-form.js',
  'js/tools/library/book.js',
  'js/tools/library/data.js',
  'js/tools/library/index.js',
  'js/tools/library/isbn.js',
  'js/tools/library/library.js',
  'js/tools/library/lookup.js',
  'js/tools/library/pending.js',
  'js/tools/library/scan.js',
  'js/tools/library/stats.js',
  'js/tools/photo/cull.js',
  'js/tools/photo/data.js',
  'js/tools/photo/export.js',
  'js/tools/photo/files.js',
  'js/tools/photo/import.js',
  'js/tools/photo/index.js',
  'js/tools/photo/match.js',
  'js/tools/photo/raw.js',
  'js/tools/photo/stats.js',
  'js/tools/photo/touchline.js',
  'js/tools/photo/zip.js',
  'js/tools/sports/common.js',
  'js/tools/sports/cricket-live.js',
  'js/tools/sports/cricket.js',
  'js/tools/sports/dashboard.js',
  'js/tools/sports/export.js',
  'js/tools/sports/hockey.js',
  'js/tools/sports/index.js',
  'js/tools/sports/lineup.js',
  'js/tools/sports/live.js',
  'js/tools/sports/rugby.js',
  'js/tools/sports/season.js',
  'js/tools/sports/setup.js',
  'js/tools/sports/summary.js',
  'js/tools.js',
  'vendor/exifr.umd.js',
  'vendor/html5-qrcode.min.js',
  'vendor/mqtt.min.js',
  'vendor/qrcode.js',
  'vendor/supabase.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon.svg',
  'supabase/schema.sql',
];
const COVERS = 'shelf-covers';
const COVER_HOSTS = ['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com', 'archive.org', 'images.openfoodfacts.org'];

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
