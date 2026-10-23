// Guarda la app en el iPhone para que abra sin internet.
// Cambia CACHE al publicar una versión nueva.
const CACHE = 'baul-v3';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  // `reload` evita copiar versiones viejas de la caché HTTP.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Primero la copia guardada (abre al instante y sin conexión); si hay internet, se actualiza por detrás.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const network = fetch(req.url, { cache: 'no-cache' })
    .then(async res => {
      if (res.ok && !res.redirected) {
        const cache = await caches.open(CACHE);
        await cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);
  e.waitUntil(network);

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await caches.match('./index.html') : undefined);
    return cached || (await network) || new Response('Sin conexión', { status: 503 });
  })());
});
