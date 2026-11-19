// Caches the app files so it opens fast and works as an installed phone app.
// Data always comes live from the server. Bump VERSION when you change files.
const VERSION = 'tracker-v13';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.json', 'logo-wide.png', 'icon-32.png',
  'icon-192.png', 'icon-512.png',
  'vendor/chart.umd.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first (so updates show up), cache as fallback when offline
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
