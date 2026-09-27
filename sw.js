// Leidžia programai veikti be interneto. Pakeitus failus, padidink VERSION.
const VERSION = 'korteles-v14';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'geo.js', 'share.js', 'manifest.webmanifest',
  'lib/zxing.min.js', 'lib/zxing-wasm.js', 'lib/zxing_reader.wasm', 'lib/jsbarcode.min.js', 'lib/qrcode.js',
  'icons/korte-icon-180.png', 'icons/korte-icon-192.png', 'icons/korte-icon-512.png', 'icons/korte-icon-maskable-512.png', 'icons/brand-icon.svg', 'icons/logo.svg', 'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))) /* visada švieži failai, ne iš naršyklės atminties */).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pagrindinis puslapis — pirmiausia iš interneto (kad atnaujinimai atsirastų iškart),
// be interneto arba jei atsakymas vėluoja >3 s — iš talpyklos.
// Kiti failai — iš karto iš talpyklos, o fone parsisiunčiama naujesnė versija.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(VERSION).then(async cache => {
      const cached = cache.match('./', { ignoreSearch: true }).then(r => r || cache.match('index.html'));
      const network = fetch(req).then(res => { if (res.ok) cache.put('./', res.clone()); return res; });
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch (err) { /* be interneto */ }
      return (await cached) || network;
    }));
    return;
  }
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
