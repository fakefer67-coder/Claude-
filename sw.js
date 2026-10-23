// Guarda la app en el iPhone para que abra sin internet.
// Cambia CACHE al publicar una versión nueva.
const CACHE = 'baul-v9';
// Copia temporal de la app web que se está usando (la crea y la borra app.js).
const RUN_CACHE = 'baul-run';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './emulator.html',
  './dos.html',
  './apk-shim.js',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== RUN_CACHE).map(async k => {
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

  // Apps web abiertas desde el baúl: sus archivos están en la copia temporal, nunca en internet.
  if (url.pathname.startsWith(new URL('run/', self.registration.scope).pathname)) {
    e.respondWith(runFile(req));
    return;
  }

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

// Misma forma para «Mi foto.png», «Mi%20foto.png» o «Mi foto.png?v=2» (las apps escriben las rutas de muchas maneras).
function canonical(href) {
  const url = new URL(href);
  const decode = part => { try { return decodeURIComponent(part); } catch { return part; } };
  return url.origin + url.pathname.split('/').map(p => encodeURIComponent(decode(p))).join('/');
}

async function runFile(req) {
  const cache = await caches.open(RUN_CACHE);
  const res = await cache.match(canonical(req.url));
  if (!res) return new Response('No encontrado', { status: 404 });
  // Safari pide los vídeos y sonidos por trozos.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!range) return res;
  const blob = await res.blob();
  const size = blob.size;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
