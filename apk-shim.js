'use strict';
// Se carga antes que una app web abierta desde el Baúl (un .apk con HTML5 o un .zip con un juego web).
// Le da a cada app su propio almacenamiento y le responde lo que esperaría de Android.
(() => {
  const id = (/\/run\/([^/]+)\//.exec(location.pathname) || [])[1] || 'app';
  const ns = `apk:${id}:`;

  // localStorage propio: las partidas de dos juegos distintos no se pisan entre sí.
  try {
    const real = window.localStorage;
    const keys = () => {
      const out = [];
      for (let i = 0; i < real.length; i++) {
        const k = real.key(i);
        if (k && k.startsWith(ns)) out.push(k.slice(ns.length));
      }
      return out;
    };
    const api = {
      getItem: k => real.getItem(ns + k),
      setItem: (k, v) => real.setItem(ns + k, String(v)),
      removeItem: k => real.removeItem(ns + k),
      clear: () => { for (const k of keys()) real.removeItem(ns + k); },
      key: i => keys()[i] ?? null,
      get length() { return keys().length; },
    };
    // También vale localStorage.partida = '…' y localStorage['partida'].
    const store = new Proxy(api, {
      get: (t, p) => (p in t ? t[p] : typeof p === 'string' ? (t.getItem(p) ?? undefined) : undefined),
      set: (t, p, v) => { t.setItem(p, v); return true; },
      deleteProperty: (t, p) => { t.removeItem(p); return true; },
      has: (t, p) => p in t || (typeof p === 'string' && t.getItem(p) !== null),
      ownKeys: () => keys(),
      getOwnPropertyDescriptor: (t, p) => {
        const v = typeof p === 'string' ? t.getItem(p) : null;
        return v === null ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
      },
    });
    Object.defineProperty(window, 'localStorage', { get: () => store, configurable: true });
  } catch { /* sin almacenamiento: el juego funciona, pero no guarda */ }

  // IndexedDB con nombres propios de esta app.
  try {
    const idb = window.indexedDB;
    const open = idb.open.bind(idb);
    const remove = idb.deleteDatabase.bind(idb);
    idb.open = (name, ...rest) => open(ns + name, ...rest);
    idb.deleteDatabase = name => remove(ns + name);
    if (idb.databases) {
      const list = idb.databases.bind(idb);
      idb.databases = async () => (await list())
        .filter(d => d.name?.startsWith(ns))
        .map(d => ({ ...d, name: d.name.slice(ns.length) }));
    }
  } catch { /* sin IndexedDB */ }

  // Una app no puede instalar su propio service worker dentro del Baúl.
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('No disponible en el Baúl'));
  } catch { /* nada */ }

  // Cordova habla con Android a través de prompt('…', 'gap…'): aquí no hay Android, así que responde vacío.
  // Así tampoco aparecen cuadros de texto vacíos y la app recibe «deviceready».
  const ask = window.prompt;
  window.prompt = (message, value) => (typeof value === 'string' && value.startsWith('gap') ? '' : ask.call(window, message, value));
})();
