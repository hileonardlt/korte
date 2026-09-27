// Leidžia programai veikti be interneto. Pakeitus failus, padidink VERSION.
const VERSION = 'korteles-v8';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'geo.js', 'share.js', 'manifest.webmanifest',
  'lib/zxing.min.js', 'lib/zxing-wasm.js', 'lib/zxing_reader.wasm', 'lib/jsbarcode.min.js', 'lib/qrcode.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/brand-icon.svg', 'icons/logo.svg', 'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Atidarome iš karto iš talpyklos (greita ir be interneto), o fone parsisiunčiame naujesnę versiją
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
