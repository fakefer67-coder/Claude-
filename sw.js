// Guarda la app en el iPhone para que abra sin internet.
// Cambia CACHE al publicar una versión nueva.
const CACHE = 'baul-v7';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './emulator.html',
  './dos.html',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/mediabunny-1.61.3.min.mjs',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(async k => {
        // Conservar los emuladores y librerías ya descargados al cambiar de versión.
        const old = await caches.open(k);
        const keep = await caches.open(CACHE);
        for (const r of await old.keys()) {
          if (new URL(r.url).pathname.includes('/vendor/')) await keep.put(r, await old.match(r));
        }
        return caches.delete(k);
      })))
      .then(() => self.clients.claim()),
  );
});

// Primero la copia guardada (abre al instante y sin conexión); si hay internet, se actualiza por detrás.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Librerías y emuladores no cambian (llevan la versión en la ruta): si ya están guardados, no se vuelven a bajar.
  if (url.pathname.includes('/vendor/')) {
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

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
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await network;
    if (res) return res;
    // Sin conexión: la portada de la app sirve para cualquier ruta suya, pero no para otras páginas (p. ej. el emulador).
    const isAppShell = req.mode === 'navigate' && new URL(self.registration.scope).pathname === url.pathname.replace(/index\.html$/, '');
    return (isAppShell && await caches.match('./index.html')) || new Response('Sin conexión', { status: 503 });
  })());
});
