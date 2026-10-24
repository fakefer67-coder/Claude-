'use strict';

const APP_VERSION = '2.9.3';

/* ================= Utilidades ================= */

const $ = (sel, el = document) => el.querySelector(sel);
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function fmtBytes(n) {
  if (!n || n < 0) return '0\u00a0KB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i < 2 ? Math.round(n) : nf1.format(n)}\u00a0${units[i]}`;
}
const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
const minusPct = (part, total) => `−${pct(part, total)}\u00a0%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtDur = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtDate = ms => new Date(ms).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const byName = (a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });

// localStorage solo para preferencias; puede fallar en modo privado.
const prefs = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin preferencias */ } },
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  move: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13h6M13 10l3 3-3 3',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
};
function svgIcon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}
function folderGlyph() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 52');
  svg.setAttribute('class', 'fold-icon');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#folderShape');
  svg.append(use);
  return svg;
}
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/* ================= Base de datos (IndexedDB) ================= */
// meta:    datos de cada archivo (nombre, tipo, carpeta...), cifrados
// blobs:   contenido cifrado
// thumbs:  miniatura cifrada para la cuadrícula
// folders: carpetas, cifradas
// config:  llave del baúl, protegida con el código

const FILE_STORES = ['meta', 'blobs', 'thumbs'];
const ALL_STORES = [...FILE_STORES, 'folders', 'config'];

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('baul', 3);
    r.onupgradeneeded = () => {
      for (const s of ALL_STORES) {
        if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const t = (await db()).transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada'));
  });
  const r = fn(...stores.map(s => t.objectStore(s)));
  await done;
  return r instanceof IDBRequest ? r.result : r;
}

const dbGetConfig = () => tx(['config'], 'readonly', c => c.get('vault'));
const dbSetConfig = cfg => tx(['config'], 'readwrite', c => { c.put(cfg, 'vault'); });
const dbRawMetas = () => tx(['meta'], 'readonly', m => m.getAll());
const dbRawFolders = () => tx(['folders'], 'readonly', f => f.getAll());
const dbBlob = id => tx(['blobs'], 'readonly', b => b.get(id));
const dbThumb = id => tx(['thumbs'], 'readonly', t => t.get(id));
const dbPutMeta = rec => tx(['meta'], 'readwrite', m => { m.put(rec, rec.id); });
const dbPutFolder = rec => tx(['folders'], 'readwrite', f => { f.put(rec, rec.id); });
const dbPut = (rec, blob, thumb) => tx(FILE_STORES, 'readwrite', (m, b, t) => {
  m.put(rec, rec.id);
  b.put(blob, rec.id);
  if (thumb) t.put(thumb, rec.id);
});
// Sustituye un archivo solo si sigue existiendo (pudo borrarse mientras se comprimía).
function dbReplaceIfExists(rec, blob, thumb) {
  let existed = false;
  return tx(FILE_STORES, 'readwrite', (m, b, t) => {
    const g = m.get(rec.id);
    g.onsuccess = () => {
      if (!g.result) return;
      existed = true;
      m.put(rec, rec.id);
      if (blob) b.put(blob, rec.id);
      if (thumb) t.put(thumb, rec.id);
    };
  }).then(() => existed);
}
const dbDelete = ids => tx(FILE_STORES, 'readwrite', (m, b, t) => {
  for (const id of ids) { m.delete(id); b.delete(id); b.delete(dosSaveKey(id)); t.delete(id); }
});
const dbDeleteFolders = ids => tx(['folders'], 'readwrite', f => { for (const id of ids) f.delete(id); });
const dbClear = () => tx([...FILE_STORES, 'folders'], 'readwrite', (...stores) => { for (const s of stores) s.clear(); });
const dbWipeAll = () => tx(ALL_STORES, 'readwrite', (...stores) => { for (const s of stores) s.clear(); });

function requestPersist() {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

/* ================= Cifrado ================= */
// Una llave aleatoria AES-256-GCM cifra todo lo guardado. Esa llave se guarda cifrada con otra
// derivada del código (PBKDF2), así cambiar el código no obliga a recifrar los archivos.

const PIN_LENGTH = 6;
const KDF_ITERATIONS = 600_000;
const CHUNK = 4 * 1024 * 1024;
const te = new TextEncoder();
const td = new TextDecoder();
let masterKey = null;

async function deriveKek(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
const importMaster = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function sealBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function openBytes(sealed, key) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) }, key, sealed.subarray(12)));
}
const sealJSON = (obj, key) => sealBytes(te.encode(JSON.stringify(obj)), key);
const openJSON = async (sealed, key) => JSON.parse(td.decode(await openBytes(sealed, key)));

// Los archivos se cifran por trozos de 4 MB para no agotar la memoria del iPhone con vídeos grandes.
// Formato: [prefijo aleatorio de 8 bytes][trozo 0 cifrado][trozo 1 cifrado]...
function chunkIv(prefix, i) {
  const iv = new Uint8Array(12);
  iv.set(prefix);
  new DataView(iv.buffer).setUint32(8, i);
  return iv;
}
async function encryptBlob(blob, key) {
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const parts = [prefix];
  let i = 0;
  let off = 0;
  do {
    const plain = await blob.slice(off, off + CHUNK).arrayBuffer();
    parts.push(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(prefix, i) }, key, plain));
    off += CHUNK;
    i++;
  } while (off < blob.size);
  return new Blob(parts);
}
async function decryptBlob(blob, key, type = '') {
  const prefix = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const parts = [];
  let i = 0;
  let off = 8;
  do {
    const ct = await blob.slice(off, off + CHUNK + 16).arrayBuffer();
    parts.push(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(prefix, i) }, key, ct));
    off += CHUNK + 16;
    i++;
  } while (off < blob.size);
  return new Blob(parts, { type });
}

async function wrapMaster(raw, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKek(pin, salt, KDF_ITERATIONS);
  return { salt, iterations: KDF_ITERATIONS, wrapped: await sealBytes(raw, kek) };
}
// Devuelve la llave en bruto si el código es correcto; si no, null.
async function unwrapMaster(cfg, pin) {
  try { return await openBytes(cfg.wrapped, await deriveKek(pin, cfg.salt, cfg.iterations)); } catch { return null; }
}
async function createVault(pin) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await dbSetConfig({ ...(await wrapMaster(raw, pin)), created: Date.now() });
  masterKey = await importMaster(raw);
  raw.fill(0);
}
async function unlockVault(pin) {
  const raw = await unwrapMaster(await dbGetConfig(), pin);
  if (!raw) return false;
  masterKey = await importMaster(raw);
  raw.fill(0);
  return true;
}

const sealMeta = async (meta, key = masterKey) => ({ id: meta.id, e: await sealJSON(meta, key) });
const saveMeta = async meta => dbPutMeta(await sealMeta(meta));
const saveFolder = async folder => dbPutFolder({ id: folder.id, e: await sealJSON(folder, masterKey) });

async function loadMetas() {
  const recs = await dbRawMetas();
  return Promise.all(recs.filter(r => r.e).map(r => openJSON(r.e, masterKey)));
}
async function loadFolders() {
  const recs = await dbRawFolders();
  return Promise.all(recs.map(r => openJSON(r.e, masterKey)));
}

// Archivos guardados por la versión 1.0 (sin código): se cifran la primera vez que se abre el baúl.
async function encryptLegacy() {
  const legacy = (await dbRawMetas()).filter(r => !r.e);
  for (const meta of legacy) {
    const blob = await dbBlob(meta.id);
    if (!blob) { await dbDelete([meta.id]); continue; }
    const thumb = await dbThumb(meta.id);
    const sealed = await encryptBlob(blob, masterKey);
    meta.storedSize = sealed.size;
    await dbPut(await sealMeta(meta), sealed, thumb && await encryptBlob(thumb, masterKey));
  }
}

/* ================= Tipos de archivo ================= */

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff',
  tiff: 'image/tiff', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', aif: 'audio/aiff',
  aiff: 'audio/aiff', caf: 'audio/x-caf', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  pdf: 'application/pdf', rtf: 'application/rtf',
  txt: 'text/plain', text: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', geojson: 'application/geo+json',
  ndjson: 'application/x-ndjson', webmanifest: 'application/manifest+json', xml: 'application/xml',
  gpx: 'application/gpx+xml', kml: 'application/vnd.google-earth.kml+xml',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', ini: 'text/plain', conf: 'text/plain', cfg: 'text/plain',
  env: 'text/plain', properties: 'text/plain', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', jsx: 'text/plain', tsx: 'text/plain', vue: 'text/plain',
  py: 'text/x-python', rb: 'text/plain', php: 'text/plain', java: 'text/plain', kt: 'text/plain', swift: 'text/plain',
  c: 'text/plain', h: 'text/plain', cpp: 'text/plain', hpp: 'text/plain', cs: 'text/plain', go: 'text/plain',
  rs: 'text/plain', sh: 'text/x-shellscript', zsh: 'text/plain', bash: 'text/plain', sql: 'text/plain',
  srt: 'text/plain', vtt: 'text/vtt', tex: 'text/plain', bib: 'text/plain', vcf: 'text/vcard', ics: 'text/calendar',
  zip: 'application/zip', epub: 'application/epub+zip', gz: 'application/gzip', '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/x-iwork-pages-sffpages', numbers: 'application/x-iwork-numbers-sffnumbers',
  key: 'application/x-iwork-keynote-sffkey',
};
const TEXT_EXTS = new Set(Object.keys(EXT_MIME).filter(e => /^text\/|json|xml|yaml/.test(EXT_MIME[e])));
const extOf = name => (/\.([^./]+)$/.exec(name || '')?.[1] || '').toLowerCase();
const mimeOf = file => {
  const t = (file.type || '').toLowerCase();
  return t && t !== 'application/octet-stream' ? t : EXT_MIME[extOf(file.name)] || 'application/octet-stream';
};

function kindOf(type, name = '') {
  if (type === 'image/heic' || type === 'image/heif' || (type.startsWith('image/') && type !== 'image/x-icon')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/') || /json|xml|javascript|yaml/.test(type) || TEXT_EXTS.has(extOf(name))) return 'text';
  return 'other';
}

// Formatos que ya vienen comprimidos: gzip no ganaría nada y solo gastaría batería.
const ALREADY_COMPRESSED = /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|video\/|audio\/(mpeg|mp4|aac|ogg|x-m4a|webm|flac)|application\/(zip|epub\+zip|x-7z-compressed|vnd\.rar|gzip|vnd\.openxmlformats|x-iwork))/;

const CODE_EXTS = new Set(['js', 'mjs', 'jsx', 'tsx', 'vue', 'py', 'rb', 'php', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'sh', 'zsh', 'bash', 'sql', 'css', 'html', 'htm']);
// Juegos de consolas clásicas que se pueden jugar con el emulador integrado (EmulatorJS).
const GAME_SYSTEMS = {
  nes: { name: 'NES', label: 'NES', exts: ['nes', 'fds', 'unf', 'unif'] },
  snes: { name: 'Super Nintendo', label: 'SNES', exts: ['sfc', 'smc', 'fig', 'swc', 'bs'] },
  gb: { name: 'Game Boy / Color', label: 'GB', exts: ['gb', 'gbc', 'sgb'] },
  gba: { name: 'Game Boy Advance', label: 'GBA', exts: ['gba', 'agb'] },
  segaMD: { name: 'Mega Drive / Genesis', label: 'MD', exts: ['gen', 'smd'] },
  segaMS: { name: 'Master System', label: 'SMS', exts: ['sms'] },
  segaGG: { name: 'Game Gear', label: 'GG', exts: ['gg'] },
  n64: { name: 'Nintendo 64', label: 'N64', exts: ['n64', 'z64', 'v64'] },
  psx: { name: 'PlayStation', label: 'PS1', exts: ['pbp'] },
  nds: { name: 'Nintendo DS', label: 'NDS', exts: ['nds'] },
};
const GAME_BY_EXT = Object.fromEntries(Object.entries(GAME_SYSTEMS).flatMap(([key, s]) => s.exts.map(e => [e, key])));
// Formatos que pueden ser un juego (o no): se ofrece elegir la consola.
const MAYBE_GAME_EXTS = new Set(['zip', '7z', 'rar', 'bin', 'iso', 'img', 'chd', 'cue']);
const gameSystemOf = name => GAME_BY_EXT[extOf(name)];
// Consolas que el Baúl reconoce (para decirlo claro) pero no puede emular.
const OTHER_SYSTEMS = {
  pce: 'PC Engine', sgx: 'PC Engine', a26: 'Atari 2600', a78: 'Atari 7800', lnx: 'Atari Lynx', '32x': 'Sega 32X',
  ngp: 'Neo Geo Pocket', ngc: 'Neo Geo Pocket', wsc: 'WonderSwan', cso: 'PSP', nsp: 'Nintendo Switch', xci: 'Nintendo Switch',
  gcm: 'GameCube', rvz: 'GameCube / Wii', wbfs: 'Wii', gdi: 'Dreamcast', cdi: 'Dreamcast',
};
// Archivos en los que se mira dentro para saber de qué consola son (también sin extensión, o un .md de Mega Drive).
const DETECT_EXTS = new Set([...MAYBE_GAME_EXTS, 'rom', 'md', '']);
// Juegos de .zip que no van con el emulador, sino con otro motor del Baúl.
const PLAYABLE_KINDS = new Set(['dos', 'web', 'godot']);
// La consola de un juego: la que se detectó mirando dentro o, si no, la de su extensión.
const systemOf = meta => (GAME_SYSTEMS[meta.system] ? meta.system : gameSystemOf(meta.name));

// Programas de MS-DOS: se ejecutan dentro del baúl con js-dos (DOSBox). Un .exe puede ser de MS-DOS o de Windows.
const DOS_EXTS = new Set(['exe', 'com', 'bat', 'jsdos']);
// Juegos y programas que se pueden abrir aquí o llevar a otro sistema.
const PROGRAM_EXTS = new Set([...DOS_EXTS, 'msi', 'apk', 'xapk', 'apks', 'pck', 'love', 'swf']);

// Programas de otros sistemas: se pueden guardar, y hay formas de usarlos desde el iPhone (ver «WAYS»).
const WINDOWS_APP = 'Es un programa de Windows: no se abre aquí, pero sí con otras apps del iPhone, desde tu PC o desde la nube.';
const ANDROID_APP = 'Es una app de Android: no se abre aquí, pero sí con otras apps del iPhone, desde la nube o desde tu PC.';
const FOREIGN_APPS = {
  exe: WINDOWS_APP, msi: WINDOWS_APP,
  apk: ANDROID_APP, xapk: ANDROID_APP, apks: ANDROID_APP, aab: ANDROID_APP,
  ipa: 'Es una app de iPhone: iOS solo deja instalar apps desde la App Store, no desde archivos.',
  dmg: 'Es un programa de Mac: un iPhone no puede ejecutarlo.', pkg: 'Es un instalador de Mac: un iPhone no puede ejecutarlo.',
  deb: 'Es un programa de Linux: un iPhone no puede ejecutarlo.', appimage: 'Es un programa de Linux: un iPhone no puede ejecutarlo.',
  jar: 'Es un programa Java: un iPhone no puede ejecutarlo.',
};

// Etiqueta de cada tipo, con un tono apagado para distinguirlos de un vistazo.
const FILE_STYLE = {
  pdf: ['PDF', '#e8a3a1'], doc: ['DOC', '#a3b8e8'], docx: ['DOC', '#a3b8e8'], pages: ['PAGES', '#e8c3a1'],
  xls: ['XLS', '#a6d4b9'], xlsx: ['XLS', '#a6d4b9'], numbers: ['NUM', '#a6d4b9'], csv: ['CSV', '#a6d4b9'],
  ppt: ['PPT', '#e8bba1'], pptx: ['PPT', '#e8bba1'], key: ['KEY', '#a3b8e8'],
  zip: ['ZIP', ''], gz: ['GZ', ''], rar: ['RAR', ''], '7z': ['7Z', ''], txt: ['TXT', ''], md: ['MD', ''],
  json: ['{ }', '#e3d39f'], geojson: ['{ }', '#e3d39f'], xml: ['XML', '#c9b3e8'], yaml: ['YML', '#c9b3e8'],
  yml: ['YML', '#c9b3e8'], epub: ['EPUB', '#c9b3e8'],
  exe: ['EXE', '#b9c4ea'], com: ['DOS', '#b9c4ea'], bat: ['DOS', '#b9c4ea'], jsdos: ['DOS', '#b9c4ea'],
  apk: ['APK', '#a6d4b9'], xapk: ['APK', '#a6d4b9'], apks: ['APK', '#a6d4b9'], pck: ['PCK', '#b9c4ea'],
  love: ['LÖVE', '#e8a3c9'], swf: ['SWF', '#e8a3a1'],
};
function fileIcon(meta, big) {
  const icon = el('div', 'ficon' + (big ? ' big' : ''));
  const ext = extOf(meta.name);
  let [label, color] = FILE_STYLE[ext] || (CODE_EXTS.has(ext) ? ['</>', '#a3b8e8'] : [(ext || 'FILE').slice(0, 4).toUpperCase(), '']);
  const system = systemOf(meta);
  if (system) [label, color] = [GAME_SYSTEMS[system].label, '#b9c4ea'];
  else if (meta.system === 'dos') [label, color] = ['DOS', '#b9c4ea'];
  if (meta.kind === 'audio') [label, color] = ['♪', '#c9b3e8'];
  if (meta.kind === 'video') [label, color] = ['▶', ''];
  if (meta.kind === 'image') [label, color] = ['IMG', ''];
  icon.textContent = label;
  if (color) icon.style.color = color;
  return icon;
}

/* ================= Compresión ================= */

const QUALITY = {
  max: { side: 2048, q: 0.72 },
  balanced: { side: 2560, q: 0.82 },
  original: null,
};
let quality = prefs.get('baul.quality', 'balanced');
if (!(quality in QUALITY)) quality = 'balanced';

const canGzip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const streamBlob = (blob, transform) => new Response(blob.stream().pipeThrough(transform)).blob();
const gzip = blob => streamBlob(blob, new CompressionStream('gzip'));
const gunzip = blob => streamBlob(blob, new DecompressionStream('gzip'));

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen no legible')); };
    img.src = url;
  });
}

function drawScaled(src, maxSide, background) {
  const w0 = src.videoWidth || src.naturalWidth || src.width;
  const h0 = src.videoHeight || src.naturalHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s));
  c.height = Math.max(1, Math.round(h0 * s));
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const canvasBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
// iOS limita la memoria total de los canvas: liberarlos en cuanto se usan.
const freeCanvas = c => { c.width = c.height = 0; };

function hasTransparency(img) {
  const c = drawScaled(img, 96);
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  freeCanvas(c);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

async function makeThumb(src) {
  const c = drawScaled(src, 420, '#1a1a1e');
  const blob = await canvasBlob(c, 'image/jpeg', 0.74);
  freeCanvas(c);
  return blob;
}

function videoInfo(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    let finished = false;
    const finish = async grab => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const info = { duration: Number.isFinite(v.duration) ? v.duration : 0, w: v.videoWidth, h: v.videoHeight, thumb: null };
      if (grab && v.videoWidth) { try { info.thumb = await makeThumb(v); } catch { /* sin miniatura */ } }
      v.pause();
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = setTimeout(() => finish(true), 8000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 0) / 3); };
    v.onseeked = () => finish(true);
    v.onerror = () => finish(false);
    v.src = url;
    // iOS no carga fotogramas hasta que se intenta reproducir.
    v.play()?.then(() => v.pause()).catch(() => {});
  });
}

// ¿Parece texto (UTF-8 sin bytes nulos)? Sirve para archivos sin tipo conocido.
async function looksLikeText(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  if (!bytes.length || bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

// Optimiza el contenido de un archivo ya guardado: fotos más ligeras, miniaturas y compresión sin pérdidas.
async function optimizeContent(file, meta) {
  const r = {
    content: file, type: meta.type, kind: meta.kind, name: meta.name, thumb: null, reencoded: false,
    w: meta.w, h: meta.h, duration: meta.duration,
  };
  const q = meta.keep ? null : QUALITY[quality];
  if (r.kind === 'image') {
    try {
      const img = await loadImage(file);
      r.w = img.naturalWidth;
      r.h = img.naturalHeight;
      const vector = r.type === 'image/svg+xml';
      const mayHaveAlpha = /png|webp|gif|avif/.test(r.type);
      if (q && !vector && r.type !== 'image/gif' && !(mayHaveAlpha && hasTransparency(img))) {
        const c = drawScaled(img, q.side);
        const jpg = await canvasBlob(c, 'image/jpeg', q.q);
        // Solo nos quedamos la versión nueva si de verdad ahorra espacio.
        if (jpg && jpg.size < file.size * 0.95) {
          r.content = jpg;
          r.type = 'image/jpeg';
          r.reencoded = true;
          r.w = c.width;
          r.h = c.height;
          r.name = meta.name.replace(/\.[^./]+$/, '') + '.jpg';
        }
        freeCanvas(c);
      }
      r.thumb = await makeThumb(img);
    } catch { /* p. ej. HEIC en un sistema que no lo lee: se queda tal cual */ }
  } else if (r.kind === 'video') {
    const info = await videoInfo(file);
    Object.assign(r, { duration: info.duration, w: info.w, h: info.h, thumb: info.thumb });
  } else if (r.kind === 'other' && r.type === 'application/octet-stream' && file.size < 50e6 && await looksLikeText(file)) {
    r.kind = 'text';
    r.type = 'text/plain';
  }
  r.stored = r.content;
  r.enc = 'raw';
  if (canGzip && !ALREADY_COMPRESSED.test(r.type) && r.content.size > 256) {
    const gz = await gzip(r.content);
    if (gz.size < r.content.size * 0.97) { r.stored = gz; r.enc = 'gzip'; }
  }
  return r;
}

/* ================= Vídeos: elegir la calidad ================= */
// Los vídeos del iPhone ya vienen comprimidos: solo ocupan menos si se vuelven a codificar con menos
// resolución. Se hace en el propio dispositivo (WebCodecs, con su códec por hardware) y el audio se copia tal cual.

const VIDEO_LIB = './vendor/mediabunny-1.61.3.min.mjs';
const VIDEO_PRESETS = [
  { key: '1080', label: 'Alta', res: '1080p', short: 1080, efficient: 6e6, standard: 9e6 },
  { key: '720', label: 'Media', res: '720p', short: 720, efficient: 3e6, standard: 4.5e6 },
  { key: '480', label: 'Ahorro', res: '480p', short: 480, efficient: 1.2e6, standard: 2e6 },
];
const videoPreset = key => VIDEO_PRESETS.find(p => p.key === key);
const CODEC_NAMES = { hevc: 'HEVC (H.265)', avc: 'H.264', vp9: 'VP9', av1: 'AV1' };
const resolutionLabel = short => (short >= 2160 ? '4K' : short >= 1440 ? '2K' : `${short}p`);

let videoPref = prefs.get('baul.videoq', 'ask');
if (videoPref !== 'ask' && videoPref !== 'original' && !videoPreset(videoPref)) videoPref = 'ask';

let mediaLib;
const loadMediaLib = () => (mediaLib ??= import(VIDEO_LIB));
let encoderCodec;
// Códec con el que este dispositivo puede codificar vídeo (null si ninguno).
function videoEncoderCodec() {
  encoderCodec ??= (async () => {
    if (typeof VideoEncoder !== 'function') return null;
    try {
      const mb = await loadMediaLib();
      return await mb.getFirstEncodableVideoCodec(['hevc', 'avc', 'vp9', 'av1'], { width: 1920, height: 1080, bitrate: 6e6 });
    } catch {
      return null;
    }
  })();
  return encoderCodec;
}
// HEVC y AV1 necesitan menos bits que H.264 y VP9 para la misma calidad; 60 fps, algo más.
const presetBitrate = (preset, codec, fps = 30) =>
  (codec === 'hevc' || codec === 'av1' ? preset.efficient : preset.standard) * (fps > 40 ? 1.4 : 1);

async function probeVideo(file) {
  const mb = await loadMediaLib();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    return track ? { w: track.displayWidth, h: track.displayHeight, duration: await input.computeDuration(), size: file.size } : null;
  } finally {
    input.dispose();
  }
}

// Se lanza cuando la compresión de un vídeo se corta (app en segundo plano o bloqueada): se reintenta al volver.
class Interrupted extends Error {}
let activeConversion = null;
let conversionCancelled = false;
function interruptVideo() {
  if (!activeConversion) return;
  conversionCancelled = true;
  activeConversion.cancel().catch(() => {});
}

// Devuelve el vídeo recodificado, o null si no se puede o no merece la pena.
async function transcodeVideo(file, presetKey, onProgress) {
  const preset = videoPreset(presetKey);
  const codec = await videoEncoderCodec();
  if (!preset || !codec) return null;
  const mb = await loadMediaLib();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const w = track.displayWidth;
    const h = track.displayHeight;
    const stats = await track.computePacketStats(120);
    const bitrate = presetBitrate(preset, codec, stats.averagePacketRate);
    const scale = Math.min(1, preset.short / Math.min(w, h));
    // Ya es de esta calidad o menos: no merece la pena volver a codificarlo.
    if (scale === 1 && stats.averageBitrate <= bitrate * 1.2) return null;
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    // Solo se fija el lado corto; el otro sale de la proporción del vídeo (también si está girado).
    const shortSide = w <= h ? { width: even(w * scale) } : { height: even(h * scale) };
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input, output, tracks: 'primary', showWarnings: false,
      video: { ...shortSide, codec, quality: new mb.Quality({ bitrate }), forceTranscode: true },
    });
    // Si el audio o el vídeo no se pudieran conservar, mejor dejarlo como está.
    if (!conversion.isValid || conversion.discardedTracks.some(d => d.track.type === 'audio' || d.track.type === 'video')) return null;
    conversion.onProgress = p => onProgress?.(p);
    conversionCancelled = false;
    activeConversion = conversion;
    try {
      await conversion.execute();
    } catch (err) {
      if (conversionCancelled) throw new Interrupted('Compresión de vídeo interrumpida');
      throw err;
    } finally {
      activeConversion = null;
    }
    return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), w: even(w * scale), h: even(h * scale) };
  } finally {
    input.dispose();
  }
}

let videoJob = null;
async function compressVideoStep(r, meta) {
  videoJob = { progress: 0 };
  updateActivity();
  // Que la pantalla no se apague mientras tanto (el iPhone pausaría la app).
  const wake = await navigator.wakeLock?.request('screen').catch(() => null);
  try {
    const out = await transcodeVideo(r.content, meta.vq, p => { videoJob.progress = p; activitySoon(); });
    if (out && out.blob.size < r.content.size * 0.9) {
      Object.assign(r, { content: out.blob, stored: out.blob, enc: 'raw', type: 'video/mp4', w: out.w, h: out.h, vcompressed: meta.vq });
      r.name = meta.name.replace(/\.[^./]+$/, '') + '.mp4';
    } else if (!out && !(await videoEncoderCodec())) {
      toast('Este dispositivo no permite comprimir vídeos: se quedan en su calidad original');
    }
  } catch (err) {
    if (err instanceof Interrupted) throw err;
    console.error(err);
    toast(`No se pudo comprimir «${meta.name}»: se queda en su calidad original`);
  } finally {
    videoJob = null;
    wake?.release().catch(() => {});
    updateActivity();
  }
}

// Menú para elegir la calidad. `infos`: [{ size, duration, w, h }] de cada vídeo.
async function chooseVideoQuality(infos, { recompress = false } = {}) {
  const codec = await videoEncoderCodec();
  if (!codec) {
    toast('Este dispositivo no permite comprimir vídeos: se guardan en calidad original');
    return recompress ? undefined : 'original';
  }
  const size = infos.reduce((s, v) => s + (v.size || 0), 0);
  const known = infos.every(v => v.duration > 0);
  const duration = infos.reduce((s, v) => s + (v.duration || 0), 0);
  const shortSide = Math.max(0, ...infos.map(v => Math.min(v.w || 0, v.h || 0)));
  const options = [];
  if (!recompress) options.push({ label: 'Original', sub: `Sin tocar · ${fmtBytes(size)}`, value: 'original', icon: ICON.film });
  for (const p of VIDEO_PRESETS) {
    let sub = '';
    if (known && size) {
      const est = Math.min(size, ((presetBitrate(p, codec) + 160e3) * duration) / 8);
      sub = est < size * 0.9 ? `≈ ${fmtBytes(est)} (${minusPct(size - est, size)})` : 'Ya ocupa poco: apenas cambiaría';
    }
    options.push({ label: `${p.label} · ${p.res}`, sub, value: p.key, icon: ICON.film });
  }
  const res = shortSide ? ` (${resolutionLabel(shortSide)})` : '';
  const title = recompress
    ? `Cambiar la calidad del vídeo${res}`
    : infos.length === 1 ? `¿En qué calidad guardo el vídeo${res}?` : `¿En qué calidad guardo los ${infos.length} vídeos?`;
  const note = recompress
    ? 'La versión guardada se sustituye por la nueva. Tarda más o menos lo que dura el vídeo y necesita la app abierta.'
    : 'Comprimir tarda más o menos lo que dura el vídeo y necesita la app abierta. Se guarda solo la versión elegida.';
  return menu(title, options, note);
}

function setVideoQuality(m, value) {
  delete m.batch;
  if (videoPreset(value)) m.vq = value;
  else delete m.vq;
}

async function applyVideoChoice(choice, value) {
  choice.value = value;
  for (const m of state.items) {
    if (m.vq === 'ask' && m.batch === choice.id) {
      setVideoQuality(m, value);
      await saveMeta(m);
    }
  }
  renderSoon();
  runOptimizer();
}

async function askVideoQualityFor(files, choice) {
  const infos = await Promise.all(files.map(f => probeVideo(f).catch(() => null)));
  const value = await chooseVideoQuality(infos.map((info, i) => info || { size: files[i].size }));
  // Si se bloqueó con la pregunta abierta, se vuelve a preguntar al desbloquear.
  if (locked) return;
  await applyVideoChoice(choice, value ?? 'original');
}

// Vídeos que se quedaron sin elegir calidad (se cerró la app antes de responder).
async function askPendingVideoQuality() {
  const waiting = state.items.filter(m => m.vq === 'ask');
  if (!waiting.length) return;
  const value = await chooseVideoQuality(waiting.map(m => ({ size: m.size, duration: m.duration, w: m.w, h: m.h })));
  if (locked) return;
  for (const m of waiting) {
    setVideoQuality(m, value ?? 'original');
    await saveMeta(m);
  }
  renderSoon();
  runOptimizer();
}

/* ================= Guardar sin esperar ================= */
// Paso 1 (rápido): cada archivo se cifra y se guarda tal cual nada más elegirlo.
// Paso 2 (lento, en segundo plano): se comprime y se le hace la miniatura. Si se sale de la app o se
// apaga el móvil, lo ya guardado está a salvo y el paso 2 continúa solo la próxima vez que se abre.

const queue = { total: 0, done: 0 };
let queueChain = Promise.resolve();
const isCopying = () => queue.done < queue.total;
let optimizing = false;

function addFiles(fileList, opts = {}) {
  const files = [...fileList];
  if (!files.length) return queueChain;
  requestPersist();
  queue.total += files.length;
  updateActivity();
  const folder = opts.folder !== undefined ? opts.folder : state.folder;
  queueChain = queueChain.then(() => ingestList(files, { ...opts, folder }));
  return queueChain;
}

async function ingestList(files, opts) {
  const failed = [];
  for (const f of files) {
    try {
      const meta = await ingestOne(f, opts);
      // La calidad se eligió mientras este vídeo se estaba guardando.
      if (meta.vq === 'ask' && opts.videoChoice && opts.videoChoice.value !== 'ask') {
        setVideoQuality(meta, opts.videoChoice.value);
        await saveMeta(meta);
      }
      if (!locked) { state.items.unshift(meta); renderSoon(); }
    } catch (err) {
      console.error(err);
      failed.push(`${f.name}${err?.name === 'QuotaExceededError' ? ' (sin espacio)' : ''}`);
    }
    queue.done++;
    updateActivity();
  }
  if (!isCopying()) {
    queue.total = queue.done = 0;
    // Si se bloqueó mientras se guardaba, la llave se borra ahora que ya no hace falta.
    if (locked) masterKey = null;
  }
  updateActivity();
  if (failed.length && !locked) {
    ask({ title: 'Algunos archivos no se guardaron', message: `${failed.join('\n')}\n\nComprueba que tu iPhone tiene espacio libre.`, cancel: null });
  }
  runOptimizer();
}

async function ingestOne(file, { keepOriginal = false, added, originalSize, folder = null, videoChoice = null } = {}) {
  const type = mimeOf(file);
  const meta = {
    id: uid(), name: file.name || 'archivo', type, kind: kindOf(type, file.name),
    size: originalSize || file.size, outSize: file.size, storedSize: 0, enc: 'raw', status: 'raw',
    keep: keepOriginal, folder, added: added || Date.now(),
  };
  if (meta.kind === 'video' && videoChoice) {
    if (videoChoice.value === 'ask') { meta.vq = 'ask'; meta.batch = videoChoice.id; }
    else setVideoQuality(meta, videoChoice.value);
  }
  // Juegos sin extensión clara (.zip, .bin, .iso…): se mira dentro para saber de qué consola son.
  if (DETECT_EXTS.has(extOf(meta.name)) && !['image', 'video', 'audio', 'pdf'].includes(meta.kind)) {
    const found = await detectGame(file, meta.name).catch(() => null);
    if (found?.system || found?.kind) meta.system = found.system || found.kind;
  }
  // Al cifrar se crea una copia propia: el archivo del selector de iOS es temporal.
  const sealed = await encryptBlob(file, masterKey);
  meta.storedSize = sealed.size;
  await dbPut(await sealMeta(meta), sealed, null);
  return meta;
}

async function runOptimizer() {
  if (optimizing) return;
  optimizing = true;
  updateActivity();
  try {
    while (!locked && masterKey) {
      // Primero lo rápido; los vídeos a comprimir, al final. Los que esperan a que se elija calidad, no.
      const waiting = state.items.filter(m => m.status === 'raw' && m.vq !== 'ask');
      const next = waiting.find(m => !videoPreset(m.vq)) || waiting[0];
      if (!next) break;
      try {
        await optimizeOne(next);
      } catch (err) {
        if (err instanceof Interrupted || locked || !masterKey) break;
        console.error(err);
        // No se pudo optimizar: se queda guardado tal cual (si no se ha borrado mientras tanto).
        delete next.status;
        await dbReplaceIfExists(await sealMeta(next), null, null).catch(() => {});
      }
      renderSoon();
    }
  } finally {
    optimizing = false;
    updateActivity();
  }
}

async function optimizeOne(meta) {
  const key = masterKey;
  const raw = await dbBlob(meta.id);
  if (!raw) { state.items = state.items.filter(m => m !== meta); return; }
  const file = new File([await decryptBlob(raw, key, meta.type)], meta.name, { type: meta.type });
  const r = await optimizeContent(file, meta);
  if (r.kind === 'video' && videoPreset(meta.vq)) await compressVideoStep(r, meta);
  const sealed = r.stored !== file ? await encryptBlob(r.stored, key) : null;
  const thumb = r.thumb ? await encryptBlob(r.thumb, key) : null;
  // Mezclar con los datos actuales: pudo renombrarse o moverse mientras tanto.
  const current = state.items.find(m => m.id === meta.id) || meta;
  const updated = {
    ...current, type: r.type, kind: r.kind, outSize: r.content.size, enc: r.enc, reencoded: r.reencoded,
    w: r.w, h: r.h, duration: r.duration,
  };
  if (r.name !== meta.name && current.name === meta.name) updated.name = r.name;
  if (sealed) updated.storedSize = sealed.size;
  if (thumb) updated.thumbReady = true;
  if (r.vcompressed) updated.vcompressed = r.vcompressed;
  delete updated.status;
  delete updated.vq;
  delete updated.batch;
  if (!(await dbReplaceIfExists(await sealMeta(updated, key), sealed, thumb))) return;
  Object.assign(current, updated);
  delete current.status;
  delete current.vq;
}

let activityQueued = false;
function activitySoon() {
  if (activityQueued) return;
  activityQueued = true;
  requestAnimationFrame(() => { activityQueued = false; updateActivity(); });
}

function updateActivity() {
  const box = $('#activity');
  const copying = isCopying();
  const pending = locked ? 0 : state.items.filter(m => m.status === 'raw' && m.vq !== 'ask').length;
  const show = !locked && (copying || pending > 0 || !!videoJob);
  box.hidden = !show;
  if (!show) return;
  if (videoJob && !copying) {
    const p = Math.round(videoJob.progress * 100);
    box.classList.remove('indeterminate');
    $('#actTitle').textContent = `Comprimiendo vídeo · ${p} %${pending > 1 ? ` · quedan ${pending - 1}` : ''}`;
    $('#actSub').textContent = 'Mantén la app abierta. Si sales, seguirá al volver';
    $('#actBar').style.width = `${p}%`;
  } else if (copying) {
    box.classList.remove('indeterminate');
    $('#actTitle').textContent = queue.total > 1 ? `Guardando ${Math.min(queue.done + 1, queue.total)} de ${queue.total}…` : 'Guardando…';
    $('#actSub').textContent = 'Si sales de la app, seguirá al volver';
    $('#actBar').style.width = `${Math.round((queue.done / queue.total) * 100)}%`;
  } else {
    box.classList.add('indeterminate');
    $('#actTitle').textContent = `Guardado ✓ · comprimiendo ${plural(pending, 'archivo', 'archivos')}`;
    $('#actSub').textContent = 'Puedes salir o apagar el móvil: seguirá al volver';
  }
}

// Recupera el archivo listo para ver o compartir (descifrado y descomprimido).
async function getContent(meta) {
  const raw = await dbBlob(meta.id);
  if (!raw) throw new Error('No se encontró el archivo');
  let blob = await decryptBlob(raw, masterKey);
  if (meta.enc === 'gzip') blob = await gunzip(blob);
  return new File([blob], meta.name, { type: meta.type, lastModified: meta.added });
}

/* ================= ZIP (copias de seguridad) ================= */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

async function crc32(blob) {
  let c = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) c = CRC_TABLE[(c ^ value[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// ZIP sin compresión extra (el contenido ya está comprimido y cifrado).
async function buildZip(entries, onProgress) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const { name, blob, date } = entries[i];
    onProgress?.(i, entries.length, name);
    const nameBytes = enc.encode(name);
    const crc = await crc32(blob);
    const size = blob.size;
    const { time, date: dosDate } = dosDateTime(date);
    if (offset + size > 0xffffffff) throw new Error('La copia supera 4 GB. Exporta por partes.');

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // nombres en UTF-8
    lh.setUint16(10, time, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    parts.push(lh.buffer, nameBytes, blob);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, nameBytes);

    offset += 30 + nameBytes.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

async function readZip(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No es un archivo .zip válido.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('El .zip está dañado.');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const csize = cd.getUint32(p + 20, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    const raw = async () => {
      const lh = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
      const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      return file.slice(start, start + csize);
    };
    entries.push({
      name, encrypted: (flags & 1) === 1, method, size: cd.getUint32(p + 24, true),
      async blob() {
        if (method === 0) return raw();
        if (method === 8 && canGzip) return streamBlob(await raw(), new DecompressionStream('deflate-raw'));
        throw new Error('Formato de compresión no compatible');
      },
      // Solo el principio, sin descomprimir el resto: para ver qué es sin gastar memoria.
      async head(n) {
        if (method === 0) return new Uint8Array(await (await raw()).slice(0, n).arrayBuffer());
        if (method !== 8 || !canGzip) throw new Error('Formato de compresión no compatible');
        const reader = (await raw()).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const out = new Uint8Array(n);
        let got = 0;
        try {
          while (got < n) {
            const { done, value } = await reader.read();
            if (done) break;
            out.set(value.subarray(0, n - got), got);
            got += Math.min(value.length, n - got);
          }
        } finally {
          reader.cancel().catch(() => {});
        }
        return out.subarray(0, got);
      },
    });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

/* ================= Estado, carpetas y cuadrícula ================= */

let locked = true;
let busy = false;
const state = {
  items: [],
  folders: [],
  folder: null,
  filter: 'all',
  query: '',
  selecting: false,
  selected: new Set(),
  selectedFolders: new Set(),
};
const thumbUrls = new Map();
const seenTiles = new Set();

const grid = $('#grid');
const appEl = $('#app');

const folderById = id => (id ? state.folders.find(f => f.id === id) : undefined);
// Una carpeta o archivo cuya carpeta ya no existe se trata como si estuviera en el inicio.
const parentId = f => (folderById(f.parent) ? f.parent : null);
const folderOf = m => (folderById(m.folder) ? m.folder : null);

// La carpeta y todas las que tiene dentro (null = todo el baúl).
function treeIds(rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of state.folders) {
      if (!ids.has(f.id) && ids.has(parentId(f))) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}
function folderPath(id) {
  const path = [];
  for (let f = folderById(id); f && path.length < 50; f = folderById(parentId(f))) path.unshift(f.name);
  return path;
}

function matchesFilter(m) {
  if (state.filter === 'image') return m.kind === 'image';
  if (state.filter === 'video') return m.kind === 'video';
  if (state.filter === 'file') return m.kind !== 'image' && m.kind !== 'video';
  if (state.filter === 'game') return !!systemOf(m) || PLAYABLE_KINDS.has(m.system) || PROGRAM_EXTS.has(extOf(m.name));
  return true;
}

// Sin búsqueda ni filtro se ve el contenido de la carpeta actual; con ellos, todo lo que hay dentro de ella.
function visibleEntries() {
  const q = state.query.trim().toLowerCase();
  if (state.filter === 'all' && !q) {
    return {
      folders: state.folders.filter(f => parentId(f) === state.folder).sort(byName),
      files: state.items.filter(m => folderOf(m) === state.folder),
    };
  }
  const scope = treeIds(state.folder);
  return {
    folders: q && state.filter === 'all'
      ? state.folders.filter(f => f.id !== state.folder && scope.has(f.id) && f.name.toLowerCase().includes(q)).sort(byName)
      : [],
    files: state.items.filter(m => scope.has(folderOf(m)) && matchesFilter(m) && (!q || m.name.toLowerCase().includes(q))),
  };
}

async function refresh() {
  const [items, folders] = await Promise.all([loadMetas(), loadFolders()]);
  state.items = items.sort((a, b) => b.added - a.added);
  state.folders = folders;
  const ids = new Set(state.items.map(m => m.id));
  for (const [id, url] of thumbUrls) {
    if (!ids.has(id)) { URL.revokeObjectURL(url); thumbUrls.delete(id); }
  }
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  render();
}

let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

const thumbObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    loadThumb(e.target);
  }
}, { rootMargin: '600px 0px' });

async function loadThumb(tile) {
  const id = tile.dataset.id;
  const img = tile.querySelector('img');
  let url = thumbUrls.get(id);
  if (url) {
    img.src = url;
    img.classList.add('in', 'now');
    return;
  }
  const raw = await dbThumb(id);
  if (!raw || !masterKey) return;
  try {
    url = URL.createObjectURL(await decryptBlob(raw, masterKey, 'image/jpeg'));
  } catch { return; /* el baúl se bloqueó mientras tanto */ }
  thumbUrls.set(id, url);
  img.onload = () => img.classList.add('in');
  img.src = url;
}

function renderHeader() {
  if (state.folder && !folderById(state.folder)) state.folder = null;
  const folder = folderById(state.folder);
  $('#title').textContent = folder ? folder.name : 'Baúl';
  $('#logo').hidden = !!folder;
  $('#backBtn').hidden = !folder;
  if (folder) $('#backLabel').textContent = folderById(parentId(folder))?.name || 'Baúl';
  $('#folderMenuBtn').hidden = !folder || state.selecting;
  $('#selectBtn').hidden = state.selecting;
  $('#doneBtn').hidden = !state.selecting;
  $('#search').placeholder = folder ? `Buscar en «${folder.name}»` : 'Buscar en el baúl';
  document.title = folder ? `${folder.name} · Baúl` : 'Baúl';
}

function renderStats() {
  const statsEl = $('#stats');
  if (!state.items.length && !state.folders.length) { statsEl.textContent = 'Sin internet · todo se queda en tu iPhone'; return; }
  const scope = state.folder ? treeIds(state.folder) : null;
  const files = scope ? state.items.filter(m => scope.has(folderOf(m))) : state.items;
  if (!files.length) { statsEl.textContent = state.folder ? 'Carpeta vacía' : 'Solo carpetas, todavía sin archivos'; return; }
  const size = files.reduce((s, m) => s + m.size, 0);
  const stored = files.reduce((s, m) => s + m.storedSize, 0);
  statsEl.replaceChildren();
  statsEl.append(el('b', '', plural(files.length, 'archivo', 'archivos')), ` · ${fmtBytes(stored)}`);
  if (size > stored) statsEl.append(el('span', 'save', ` · ahorrado ${fmtBytes(size - stored)} (${minusPct(size - stored, size)})`));
}

function folderTile(f, counts) {
  const tile = el('button', 'tile folder' + (state.selectedFolders.has(f.id) ? ' sel' : '') + (seenTiles.has(f.id) ? '' : ' appear'));
  seenTiles.add(f.id);
  tile.dataset.folder = f.id;
  tile.setAttribute('aria-label', `Carpeta ${f.name}`);
  const c = counts.get(f.id) || { files: 0, folders: 0 };
  const parts = [];
  if (c.folders) parts.push(plural(c.folders, 'carpeta', 'carpetas'));
  if (c.files) parts.push(plural(c.files, 'archivo', 'archivos'));
  const doc = el('div', 'doc');
  doc.append(folderGlyph(), el('span', 'name', f.name), el('span', 'count', parts.join(' · ') || 'Vacía'));
  tile.append(doc, el('span', 'check'));
  return tile;
}

function fileTile(m) {
  const tile = el('button', 'tile' + (state.selected.has(m.id) ? ' sel' : '') + (seenTiles.has(m.id) ? '' : ' appear'));
  seenTiles.add(m.id);
  tile.dataset.id = m.id;
  tile.setAttribute('aria-label', m.name);
  const pending = m.status === 'raw';
  if ((!pending || m.thumbReady) && (m.kind === 'image' || m.kind === 'video')) {
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    tile.append(img);
    thumbObserver.observe(tile);
    if (m.kind === 'video') tile.append(el('span', 'pill dur', m.duration ? fmtDur(m.duration) : '▶'));
  } else {
    const doc = el('div', 'doc');
    doc.append(fileIcon(m), el('span', 'name', m.name));
    // En los documentos el ahorro va debajo del nombre, para no taparlo.
    if (!pending) doc.append(el('span', 'count', pct(m.size - m.storedSize, m.size) >= 5 ? `${fmtBytes(m.storedSize)} · ${minusPct(m.size - m.storedSize, m.size)}` : fmtBytes(m.storedSize)));
    tile.append(doc);
  }
  const media = !!tile.querySelector('img');
  if (pending) {
    tile.classList.add('pending');
    tile.append(el('span', 'busy'));
  } else if (media && pct(m.size - m.storedSize, m.size) >= 5) {
    tile.append(el('span', 'pill save', minusPct(m.size - m.storedSize, m.size)));
  }
  tile.append(el('span', 'check'));
  return tile;
}

function render() {
  if (locked) return;
  renderHeader();
  renderStats();
  thumbObserver.disconnect();
  const { folders, files } = visibleEntries();
  const counts = new Map();
  for (const f of state.folders) {
    const p = parentId(f);
    if (p) { const c = counts.get(p) || { files: 0, folders: 0 }; c.folders++; counts.set(p, c); }
  }
  for (const m of state.items) {
    const p = folderOf(m);
    if (p) { const c = counts.get(p) || { files: 0, folders: 0 }; c.files++; counts.set(p, c); }
  }
  grid.classList.toggle('selecting', state.selecting);
  const frag = document.createDocumentFragment();
  for (const f of folders) frag.append(folderTile(f, counts));
  for (const m of files) frag.append(fileTile(m));
  grid.replaceChildren(frag);
  // Entrada escalonada de lo que aparece por primera vez.
  let n = 0;
  for (const t of grid.querySelectorAll('.tile.appear')) t.style.animationDelay = `${Math.min(n++, 24) * 18}ms`;

  const empty = !folders.length && !files.length;
  $('#empty').hidden = !empty;
  if (empty) {
    const searching = state.filter !== 'all' || state.query.trim();
    const inFolder = !!state.folder;
    $('#empty .art').hidden = searching;
    $('#emptyIcon').hidden = inFolder;
    $('#emptyFolder').hidden = !inFolder;
    $('#emptyTitle').textContent = searching ? 'Nada por aquí' : inFolder ? 'Carpeta vacía' : 'Tu baúl está vacío';
    $('#emptyText').textContent = searching
      ? 'No hay nada que coincida con este filtro o búsqueda.'
      : inFolder
        ? 'Toca «Añadir» para guardar aquí fotos, vídeos o cualquier archivo.'
        : 'Toca «Añadir» para guardar fotos, vídeos o cualquier archivo (PDF, textos, JSON…), o crea una carpeta. Todo se guarda comprimido y cifrado en este iPhone.';
  }
  renderSelectBar();
  updateActivity();
}

grid.addEventListener('click', e => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const { id, folder } = tile.dataset;
  if (state.selecting) {
    const set = folder ? state.selectedFolders : state.selected;
    const key = folder || id;
    if (set.has(key)) set.delete(key); else set.add(key);
    tile.classList.toggle('sel', set.has(key));
    renderSelectBar();
    return;
  }
  if (folder) { openFolder(folder); return; }
  const files = visibleEntries().files;
  openViewer(files, files.findIndex(m => m.id === id));
});

function openFolder(id, back = false) {
  state.folder = id;
  state.query = '';
  $('#search').value = '';
  render();
  window.scrollTo(0, 0);
  if (!REDUCED_MOTION) {
    grid.classList.remove('nav-forward', 'nav-back');
    void grid.offsetWidth;
    grid.classList.add(back ? 'nav-back' : 'nav-forward');
  }
}
function goBack() {
  const f = folderById(state.folder);
  if (f) openFolder(parentId(f), true);
}
$('#backBtn').addEventListener('click', goBack);

// Deslizar desde el borde izquierdo para volver atrás, como en las apps de iOS.
let edgeSwipe = null;
document.addEventListener('touchstart', e => {
  edgeSwipe = null;
  if (!state.folder || locked || !viewer.hidden || document.querySelector('dialog[open]') || e.touches.length !== 1) return;
  const t = e.touches[0];
  if (t.clientX < 24) edgeSwipe = { x: t.clientX, y: t.clientY };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!edgeSwipe) return;
  const t = e.changedTouches[0];
  if (t.clientX - edgeSwipe.x > 70 && Math.abs(t.clientY - edgeSwipe.y) < 60) goBack();
  edgeSwipe = null;
});

/* ================= Avisos, progreso y diálogos ================= */

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

function showProgress(title, sub, fraction) {
  $('#progress').hidden = false;
  $('#progTitle').textContent = title;
  $('#progSub').textContent = sub || '';
  $('#progBar').style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
const hideProgress = () => { $('#progress').hidden = true; };

// Diálogo genérico. `onOk` se ejecuta dentro del toque del usuario (necesario para compartir en iOS).
let askCancel = null;
function ask({ title, message = '', input = null, placeholder = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, extra = null, onOk = null }) {
  return new Promise(resolve => {
    const d = $('#dialog');
    const okBtn = $('#dlgOk');
    const cancelBtn = $('#dlgCancel');
    const inp = $('#dlgInput');
    $('#dlgTitle').textContent = title;
    $('#dlgMsg').textContent = message;
    $('#dlgExtra').replaceChildren(...(extra ? [extra] : []));
    inp.hidden = input === null;
    inp.placeholder = placeholder;
    if (input !== null) inp.value = input;
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger', danger);
    cancelBtn.hidden = !cancel;
    cancelBtn.textContent = cancel || '';
    const close = value => {
      askCancel = null;
      okBtn.onclick = cancelBtn.onclick = inp.onkeydown = d.oncancel = null;
      d.close();
      resolve(value);
    };
    okBtn.onclick = () => { onOk?.(); close(input !== null ? inp.value.trim() : true); };
    cancelBtn.onclick = () => close(input !== null ? null : false);
    askCancel = cancelBtn.onclick;
    inp.onkeydown = e => { if (e.key === 'Enter') okBtn.click(); };
    d.oncancel = e => { e.preventDefault(); close(input !== null ? null : false); };
    d.showModal();
    if (input !== null) {
      setTimeout(() => {
        inp.focus();
        const dot = inp.value.lastIndexOf('.');
        inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length);
      }, 60);
    }
  });
}

// Menú en hoja inferior. Devuelve el `value` elegido o undefined.
let menuCancel = null;
function menu(title, options, note = '') {
  return new Promise(resolve => {
    const d = $('#menu');
    const close = value => {
      menuCancel = null;
      d.onclick = d.oncancel = null;
      d.close();
      resolve(value);
    };
    $('#menuTitle').textContent = title;
    $('#menuNote').textContent = note;
    $('#menuNote').hidden = !note;
    const list = $('#menuList');
    list.replaceChildren();
    for (const o of options) {
      const b = el(o.href ? 'a' : 'button', 'row' + (o.danger ? ' danger' : ''));
      if (o.href) Object.assign(b, { href: o.href, target: '_blank', rel: 'noopener' });
      b.style.paddingLeft = `${14 + (o.depth || 0) * 20}px`;
      if (o.icon) b.append(svgIcon(o.icon));
      const text = el('span', 'grow');
      text.append(el('span', 'label', o.label));
      if (o.sub) text.append(el('span', 'sub', o.sub));
      b.append(text);
      b.onclick = () => close(o.value);
      list.append(b);
    }
    $('#menuCancel').onclick = () => close(undefined);
    d.oncancel = e => { e.preventDefault(); close(undefined); };
    d.onclick = e => {
      const r = d.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) close(undefined);
    };
    menuCancel = () => close(undefined);
    d.showModal();
  });
}

/* ================= Compartir / guardar en otras apps ================= */

function downloadFiles(files) {
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
}

// Debe llamarse directamente desde un toque: iOS lo exige para abrir el menú Compartir.
function shareFiles(files, retried = false) {
  if (navigator.canShare?.({ files })) {
    navigator.share({ files }).catch(err => {
      if (err.name === 'AbortError') return;
      if (retried) downloadFiles(files);
      else offerShare(files, 'Toca para compartir', '', true);
    });
  } else {
    downloadFiles(files);
  }
}

function offerShare(files, title, message = '', retried = false) {
  return ask({
    title, message,
    ok: navigator.canShare ? 'Guardar / Compartir' : 'Descargar',
    cancel: 'Cerrar',
    onOk: () => shareFiles(files, retried),
  });
}

/* ================= Añadir archivos y carpetas ================= */

// Mientras el selector de archivos de iOS está abierto no se bloquea el baúl.
let pickingSince = 0;
let pickTarget;
const isPicking = () => Date.now() - pickingSince < 5 * 60_000;
function openPicker(input) {
  pickingSince = Date.now();
  input.click();
}
for (const input of [$('#fileInput'), $('#restoreInput')]) {
  input.addEventListener('cancel', () => { pickingSince = 0; });
}

$('#addBtn').addEventListener('click', () => {
  pickTarget = state.folder;
  openPicker($('#fileInput'));
});
$('#fileInput').addEventListener('change', e => {
  pickingSince = 0;
  const files = [...e.target.files];
  e.target.value = '';
  // Se guarda en la carpeta que estaba abierta al tocar «Añadir».
  const folder = pickTarget !== undefined ? pickTarget : state.folder;
  pickTarget = undefined;
  if (!files.length || locked) return;
  const videos = files.filter(f => kindOf(mimeOf(f), f.name) === 'video');
  const videoChoice = videos.length ? { id: uid(), value: videoPref } : null;
  addFiles(files, { folder, videoChoice });
  if (videoChoice?.value === 'ask') askVideoQualityFor(videos, videoChoice);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#newFolderBtn').addEventListener('click', async () => {
  const parent = folderById(state.folder);
  const name = await ask({
    title: 'Nueva carpeta', message: parent ? `Dentro de «${parent.name}»` : '', input: '', placeholder: 'Nombre', ok: 'Crear',
  });
  if (name === null || locked) return;
  const folder = { id: uid(), name: name || 'Carpeta nueva', parent: state.folder, created: Date.now() };
  await saveFolder(folder);
  state.folders.push(folder);
  render();
});

$('#folderMenuBtn').addEventListener('click', async () => {
  const f = folderById(state.folder);
  if (!f) return;
  const choice = await menu(f.name, [
    { label: 'Renombrar', value: 'rename', icon: ICON.pencil },
    { label: 'Mover a…', value: 'move', icon: ICON.move },
    { label: 'Eliminar carpeta', value: 'delete', icon: ICON.trash, danger: true },
  ]);
  if (choice === 'rename') {
    const name = await ask({ title: 'Renombrar carpeta', input: f.name, ok: 'Guardar' });
    if (!name || name === f.name) return;
    f.name = name;
    await saveFolder(f);
    render();
  } else if (choice === 'move') {
    await moveEntries([], [f.id]);
  } else if (choice === 'delete') {
    await deleteEntries([], [f.id]);
  }
});

async function moveEntries(fileIds, folderIds) {
  const exclude = new Set();
  for (const id of folderIds) for (const x of treeIds(id)) exclude.add(x);
  const ROOT = '__root__';
  const options = [{ label: 'Baúl (inicio)', value: ROOT, icon: ICON.home }];
  const addLevel = (parent, depth) => {
    for (const f of state.folders.filter(x => parentId(x) === parent).sort(byName)) {
      if (exclude.has(f.id)) continue;
      options.push({ label: f.name, value: f.id, icon: ICON.folder, depth });
      addLevel(f.id, depth + 1);
    }
  };
  addLevel(null, 1);
  const n = fileIds.length + folderIds.length;
  const choice = await menu(n === 1 ? 'Mover a…' : `Mover ${n} elementos a…`, options);
  if (choice === undefined || locked) return false;
  const dest = choice === ROOT ? null : choice;
  for (const id of fileIds) {
    const m = state.items.find(x => x.id === id);
    if (!m || folderOf(m) === dest) continue;
    m.folder = dest;
    await saveMeta(m);
  }
  for (const id of folderIds) {
    const f = folderById(id);
    if (!f || parentId(f) === dest) continue;
    f.parent = dest;
    await saveFolder(f);
  }
  render();
  toast(`Movido a «${folderById(dest)?.name || 'Baúl'}»`);
  return true;
}

async function deleteEntries(fileIds, folderIds) {
  const folders = new Set();
  for (const id of folderIds) for (const x of treeIds(id)) folders.add(x);
  folders.delete(null);
  const files = new Set(fileIds);
  for (const m of state.items) if (folders.has(folderOf(m))) files.add(m.id);
  const inside = files.size - fileIds.length;
  let title;
  if (folderIds.length === 1 && !fileIds.length) title = `¿Eliminar la carpeta «${folderById(folderIds[0])?.name}»?`;
  else if (!folderIds.length) title = files.size === 1 ? '¿Eliminar este archivo?' : `¿Eliminar ${files.size} archivos?`;
  else title = `¿Eliminar ${plural(fileIds.length + folderIds.length, 'elemento', 'elementos')}?`;
  const message = (inside === 1 ? 'También se borrará el archivo que hay dentro.\n' : inside > 1 ? `También se borrarán los ${inside} archivos que hay dentro.\n` : '') + 'Se borrará del baúl para siempre.';
  if (!(await ask({ title, message, ok: 'Eliminar', danger: true }))) return false;
  // Si se borra la carpeta abierta, volver a la primera que siga existiendo.
  let current = state.folder;
  while (current && folders.has(current)) current = parentId(folderById(current));
  await dbDelete([...files]);
  await dbDeleteFolders([...folders]);
  clearWebAppData([...files]);
  state.items = state.items.filter(m => !files.has(m.id));
  state.folders = state.folders.filter(f => !folders.has(f.id));
  for (const id of files) {
    const url = thumbUrls.get(id);
    if (url) { URL.revokeObjectURL(url); thumbUrls.delete(id); }
  }
  if (current !== state.folder) openFolder(current, true);
  else render();
  return true;
}

/* ================= Selección múltiple ================= */

function renderSelectBar() {
  $('#dock').hidden = state.selecting;
  $('#selectBar').hidden = !state.selecting;
  const files = state.selected.size;
  const all = files + state.selectedFolders.size;
  $('#selShare span').textContent = files ? `Guardar (${files})` : 'Guardar';
  $('#selMove span').textContent = all ? `Mover (${all})` : 'Mover';
  $('#selDelete span').textContent = all ? `Eliminar (${all})` : 'Eliminar';
  $('#selShare').disabled = !files;
  $('#selMove').disabled = $('#selDelete').disabled = !all;
}

function setSelecting(on) {
  state.selecting = on;
  state.selected.clear();
  state.selectedFolders.clear();
  render();
}
$('#selectBtn').addEventListener('click', () => setSelecting(true));
$('#doneBtn').addEventListener('click', () => setSelecting(false));

async function prepareFiles(metas, label) {
  busy = true;
  try {
    const files = [];
    for (let i = 0; i < metas.length; i++) {
      showProgress(label, metas[i].name, i / metas.length);
      files.push(await getContent(metas[i]));
    }
    return files;
  } finally {
    busy = false;
    hideProgress();
  }
}

$('#selShare').addEventListener('click', async () => {
  const metas = state.items.filter(m => state.selected.has(m.id));
  if (!metas.length) return;
  try {
    const files = await prepareFiles(metas, 'Preparando…');
    await offerShare(files, files.length === 1 ? 'Archivo listo' : `${files.length} archivos listos`,
      'Elige «Guardar en Fotos», «Guardar en Archivos» o la app donde lo quieras.');
    setSelecting(false);
  } catch (err) {
    ask({ title: 'No se pudo preparar', message: String(err.message || err), cancel: null });
  }
});
$('#selMove').addEventListener('click', async () => {
  if (await moveEntries([...state.selected], [...state.selectedFolders])) setSelecting(false);
});
$('#selDelete').addEventListener('click', async () => {
  if (await deleteEntries([...state.selected], [...state.selectedFolders])) setSelecting(false);
});

/* ================= Filtros y búsqueda ================= */

for (const b of document.querySelectorAll('.filters button')) {
  b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    for (const o of document.querySelectorAll('.filters button')) o.setAttribute('aria-selected', String(o === b));
    render();
  });
}
$('#search').addEventListener('input', e => { state.query = e.target.value; render(); });

/* ================= Visor ================= */

const viewer = $('#viewer');
const stage = $('#stage');
const view = { list: [], index: 0, file: null, url: null, token: 0 };
const zoom = { s: 1, tx: 0, ty: 0, el: null };

function openViewer(list, index) {
  if (index < 0) return;
  view.list = list;
  viewer.hidden = false;
  viewer.classList.remove('bare');
  document.documentElement.classList.add('noscroll');
  showItem(index);
}

function closeViewer() {
  view.token++;
  viewer.hidden = true;
  document.documentElement.classList.remove('noscroll');
  stage.replaceChildren();
  zoom.el = null;
  if (view.url) URL.revokeObjectURL(view.url);
  view.url = view.file = null;
}

function step(dir) {
  const i = view.index + dir;
  if (i >= 0 && i < view.list.length) showItem(i);
}

async function showItem(index) {
  const meta = view.list[index];
  if (!meta) return closeViewer();
  view.index = index;
  const token = ++view.token;
  $('#vName').textContent = meta.name;
  $('#vCount').textContent = view.list.length > 1 ? `${index + 1} de ${view.list.length}` : '';
  $('#vShare').disabled = true;
  $('#vQuality').hidden = meta.kind !== 'video';
  zoom.el = null;
  resetZoom(false);
  stage.replaceChildren(el('div', 'spinner'));

  let file;
  try {
    file = await getContent(meta);
  } catch {
    if (token !== view.token) return;
    stage.replaceChildren(el('div', 'other', 'No se pudo abrir este archivo.'));
    return;
  }
  if (token !== view.token) return;
  if (view.url) URL.revokeObjectURL(view.url);
  view.file = file;
  view.url = URL.createObjectURL(file);
  $('#vShare').disabled = false;

  let node;
  if (meta.kind === 'image') {
    node = el('img');
    node.alt = meta.name;
    node.draggable = false;
    node.src = view.url;
    node.onerror = () => { if (token === view.token) stage.replaceChildren(otherView(meta, file)); };
    zoom.el = node;
  } else if (meta.kind === 'video') {
    node = el('video');
    node.controls = true;
    node.playsInline = true;
    node.src = view.url;
  } else if (meta.kind === 'pdf') {
    node = el('iframe');
    node.title = meta.name;
    node.src = view.url;
  } else if (meta.kind === 'text') {
    const limit = 3_000_000;
    const text = await file.slice(0, limit).text();
    if (token !== view.token) return;
    // Un .md puede ser una ROM de Mega Drive: si no es texto (lleva bytes a cero), se trata como un archivo más.
    node = meta.system || text.slice(0, 65536).includes('\0') ? otherView(meta, file) : textView(text, meta, file.size > limit);
  } else {
    node = otherView(meta, file);
  }
  stage.replaceChildren(node);
}

function highlightJSON(text) {
  const frag = document.createDocumentFragment();
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) {
      frag.append(el('span', m[2] ? 'j-key' : 'j-str', m[1]));
      if (m[2]) frag.append(m[2]);
    } else {
      frag.append(el('span', m[3] ? 'j-lit' : 'j-num', m[0]));
    }
    last = re.lastIndex;
  }
  frag.append(text.slice(last));
  return frag;
}

function textView(text, meta, truncated) {
  const box = el('div', 'textview');
  const pre = el('pre');
  const isJSON = /json/.test(meta.type) || ['json', 'geojson', 'webmanifest'].includes(extOf(meta.name));
  let shown = text;
  if (isJSON && !truncated) {
    try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* JSON no válido: se muestra tal cual */ }
  }
  if (isJSON && shown.length < 800_000) pre.append(highlightJSON(shown));
  else pre.textContent = shown;
  if (truncated) pre.append('\n\n… (archivo recortado; usa «Guardar» para abrirlo entero en otra app)');
  const copy = el('button', 'copy', 'Copiar');
  copy.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => toast('Texto copiado'), () => toast('No se pudo copiar'));
  };
  box.append(pre, copy);
  return box;
}

function otherView(meta, file) {
  const box = el('div', 'other');
  box.append(fileIcon(meta, true), el('div', 'n', meta.name), el('div', 's', fmtBytes(file.size)));
  if (meta.kind === 'audio') {
    const a = el('audio');
    a.controls = true;
    a.src = view.url;
    box.append(a);
  }
  const ext = extOf(meta.name);
  const system = gameSystemOf(meta.name);
  if (system) {
    const play = el('button', 'play', 'Jugar');
    play.onclick = () => openGame(meta, system, file);
    box.append(play, el('div', 's', `Emulador de ${GAME_SYSTEMS[system].name}`));
  } else if (DETECT_EXTS.has(ext) || OTHER_SYSTEMS[ext] || meta.system) {
    // Se mira dentro del archivo (sin descomprimirlo entero) para saber de qué consola es.
    const slot = el('div', 's', 'Mirando de qué consola es…');
    box.append(slot);
    gameOf(meta, file).then(found => slot.replaceWith(...gameActions(meta, file, found)));
  }
  if (DOS_EXTS.has(ext)) {
    // Hay que mirar dentro del .exe para saber si es de MS-DOS o de Windows.
    const slot = el('div');
    box.append(slot);
    isDosProgram(meta, file).catch(() => false).then(async dos => {
      if (dos) {
        const run = el('button', 'play', 'Ejecutar');
        run.onclick = () => openDos(meta, file);
        slot.replaceWith(run, el('div', 's', 'Programa de MS-DOS · se abre aquí mismo'));
        return;
      }
      // Un juego de Windows hecho con Godot lleva el juego (.pck) pegado al .exe: se abre con el motor web.
      const godot = ext === 'exe' ? await godotPackInfo(file).catch(() => null) : null;
      if (godot) {
        const run = el('button', 'play', 'Ejecutar');
        run.onclick = () => openGodot(meta, godot);
        slot.replaceWith(run, el('div', 's', `Juego hecho con Godot ${godot.version} · se abre aquí mismo`));
      } else {
        slot.replaceWith(el('p', 'why', WINDOWS_APP), waysButton('windows'));
      }
    });
  }
  if (ANDROID_EXTS.has(ext)) {
    // Hay que mirar dentro del .apk: si es una app web (HTML5) se abre aquí mismo.
    const slot = el('div');
    box.append(slot);
    inspectApp(meta, file).catch(() => ({})).then(info => {
      if (info.page || info.godot || info.renpy || info.love || info.flash) {
        const run = el('button', 'play', 'Ejecutar');
        run.onclick = () => (info.godot ? openGodot(meta, info) : info.renpy ? openRenpy(meta, info)
          : info.love ? openLove(meta, info) : info.flash ? openFlash(meta, info) : openWebApp(meta, file, info));
        const what = info.godot ? `Juego hecho con Godot ${info.version}` : info.renpy ? `Novela visual hecha con Ren'Py ${info.version}`
          : info.love ? 'Juego hecho con LÖVE' : info.flash ? 'Juego de Adobe AIR (Flash), experimental' : 'App web (HTML5)';
        slot.replaceWith(run, el('div', 's', `${what} · se abre aquí mismo`));
      } else {
        slot.replaceWith(el('p', 'why', nativeApkReason(info.engine)), waysButton('android'));
      }
    });
  }
  if (ext === 'swf' || ext === 'love') {
    const run = el('button', 'play', 'Ejecutar');
    run.onclick = () => (ext === 'swf' ? openFlash(meta, { swf: file }) : openLove(meta, { love: file }));
    box.append(run, el('div', 's', ext === 'swf' ? 'Juego o animación de Flash · se abre aquí mismo' : 'Juego hecho con LÖVE · se abre aquí mismo'));
  }
  if (ext === 'pck') {
    const slot = el('div');
    box.append(slot);
    godotPackInfo(file).catch(err => ({ error: err.message })).then(info => {
      if (info?.godot) {
        const run = el('button', 'play', 'Ejecutar');
        run.onclick = () => openGodot(meta, info);
        slot.replaceWith(run, el('div', 's', `Juego hecho con Godot ${info.version} · se abre aquí mismo`));
      } else {
        slot.replaceWith(el('p', 'why', info?.error || 'No es un juego de Godot que el Baúl pueda abrir.'));
      }
    });
  }
  const foreign = DOS_EXTS.has(ext) || ANDROID_EXTS.has(ext) ? null : FOREIGN_APPS[ext];
  if (foreign) box.append(el('p', 'why', foreign));
  if (ext === 'msi') box.append(waysButton('windows'));
  const open = el('button', 'open', 'Abrir en otra app');
  open.onclick = () => shareFiles([file]);
  box.append(open);
  return box;
}

/* ---- Juegos: de qué consola es (mirando dentro del archivo, no solo su nombre) ---- */

const readBytes = async (blob, start, length) => new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
const asciiAt = (b, start, length) => String.fromCharCode(...b.subarray(start, start + length));
const bytesAt = (b, start, sig) => sig.every((v, i) => b[start + i] === v);
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const MB = 1024 * 1024;

// Logotipo de Nintendo que llevan todas las ROMs de Game Boy y de GBA / DS (solo hace falta el principio).
const GB_LOGO = [0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B, 0x03, 0x73, 0x00, 0x83];
const GBA_LOGO = [0x24, 0xFF, 0xAE, 0x51, 0x69, 0x9A, 0xA2, 0x21, 0x3D, 0x84, 0x82, 0x0A];

// Super Nintendo: no tiene firma, pero sí una cabecera en 0x7FC0 (LoROM) o 0xFFC0 (HiROM), +512 si la copió un copiador.
function isSnesRom(b, size) {
  const copier = size % 1024 === 512 ? 512 : 0;
  return [0x7FC0, 0xFFC0].some(base => {
    const h = base + copier;
    if (h + 0x20 > b.length) return false;
    if ((b[h + 0x15] & 0xE0) !== 0x20 || b[h + 0x17] < 0x07 || b[h + 0x17] > 0x0D) return false;
    const checksum = b[h + 0x1E] | (b[h + 0x1F] << 8);
    const complement = b[h + 0x1C] | (b[h + 0x1D] << 8);
    const title = b.subarray(h, h + 21);
    return (checksum ^ complement) === 0xFFFF
      || (title.every(c => (c >= 0x20 && c < 0x7F) || c >= 0xA0) && title.some(c => c !== 0x20));
  });
}

// Cartuchos: cada consola deja su firma en la cabecera. `b` es el principio de la ROM (66 KB bastan).
function cartridgeSystem(b, size) {
  // Una ROM siempre tiene bytes a cero; un texto, nunca: así un README no pasa por un juego.
  if (!b.includes(0)) return null;
  if (bytesAt(b, 0, [0x4E, 0x45, 0x53, 0x1A]) || bytesAt(b, 0, [0x46, 0x44, 0x53, 0x1A])) return { system: 'nes' };
  if ([[0x80, 0x37, 0x12, 0x40], [0x37, 0x80, 0x40, 0x12], [0x40, 0x12, 0x37, 0x80]].some(sig => bytesAt(b, 0, sig))) return { system: 'n64' };
  if (bytesAt(b, 0xC0, GBA_LOGO) && b[0x15C] === 0x56 && b[0x15D] === 0xCF) return { system: 'nds' };
  if (bytesAt(b, 0x04, GBA_LOGO) && b[0xB2] === 0x96) return { system: 'gba' };
  if (bytesAt(b, 0x104, GB_LOGO)) return { system: 'gb' };
  const sega = asciiAt(b, 0x100, 16);
  if (sega.includes('SEGA')) return sega.includes('32X') ? { other: 'Sega 32X' } : { system: 'segaMD' };
  if (b[8] === 0xAA && b[9] === 0xBB && b[10] === 0x06) return { system: 'segaMD' }; // .smd entrelazado
  // Master System y Game Gear: «TMR SEGA»; el código de región dice cuál de las dos es.
  for (const at of [0x7FF0, 0x3FF0, 0x1FF0]) {
    if (asciiAt(b, at, 8) === 'TMR SEGA') return { system: b[at + 15] >> 4 >= 5 ? 'segaGG' : 'segaMS' };
  }
  if (isSnesRom(b, size)) return { system: 'snes' };
  if (asciiAt(b, 0, 4) === 'LYNX') return { other: 'Atari Lynx' };
  if (asciiAt(b, 1, 9) === 'ATARI7800') return { other: 'Atari 7800' };
  if (/^( LICENSED|COPYRIGHT) BY SNK/.test(asciiAt(b, 0, 28))) return { other: 'Neo Geo Pocket' };
  if (asciiAt(b, 0x100, 4) === 'NCSD') return { other: 'Nintendo 3DS' };
  if (asciiAt(b, 0x100, 4) === 'HEAD' || asciiAt(b, 0, 4) === 'PFS0') return { other: 'Nintendo Switch' };
  return null;
}

// Un archivo dentro de un disco ISO 9660 (para leer SYSTEM.CNF, que dice si es de PlayStation 1 o 2).
async function isoFileText(read, sectorSize, dataOffset, pvd, wanted) {
  const lba = u32le(pvd, 158), length = u32le(pvd, 166);
  for (let s = 0; s * 2048 < Math.min(length, 8 * 2048); s++) {
    const dir = await read((lba + s) * sectorSize + dataOffset, 2048);
    for (let p = 0; p + 33 < dir.length && dir[p];) {
      const name = asciiAt(dir, p + 33, dir[p + 32]).split(';')[0].toUpperCase();
      if (name === wanted) {
        const data = await read(u32le(dir, p + 2) * sectorSize + dataOffset, Math.min(u32le(dir, p + 10), 2048));
        return new TextDecoder().decode(data);
      }
      p += dir[p];
    }
  }
  return null;
}

// Discos: ISO 9660 en el sector 16, con sectores de 2048 bytes (.iso) o «en crudo» de 2352 (.bin).
async function discSystem(read) {
  for (const [sectorSize, dataOffset] of [[2048, 0], [2352, 24], [2352, 16]]) {
    const pvd = await read(16 * sectorSize + dataOffset, 2048);
    if (pvd.length < 190 || pvd[0] !== 1 || asciiAt(pvd, 1, 5) !== 'CD001') continue;
    const id = asciiAt(pvd, 8, 32).trim();
    if (id === 'PSP GAME') return { other: 'PSP' };
    if (id !== 'PLAYSTATION') return null;
    const cnf = await isoFileText(read, sectorSize, dataOffset, pvd, 'SYSTEM.CNF').catch(() => null);
    return /BOOT2\s*=/.test(cnf || '') ? { other: 'PlayStation 2' } : { system: 'psx' };
  }
  return null;
}

// CHD (discos comprimidos): sus metadatos dicen si es un CD, un GD-ROM (Dreamcast) o un DVD.
async function chdSystem(read, b) {
  const version = u32be(b, 12);
  const at = version >= 5 ? 48 : 36;
  let offset = u32be(b, at) * 2 ** 32 + u32be(b, at + 4);
  for (let i = 0; i < 16 && offset; i++) {
    const entry = await read(offset, 16);
    if (entry.length < 16) break;
    const tag = asciiAt(entry, 0, 4);
    if (tag === 'CHGD' || tag === 'CHGT') return { other: 'Dreamcast' };
    if (tag === 'DVD ') return { other: 'PlayStation 2 u otra consola de DVD' };
    if (/^CH(T2|TR|CD)$/.test(tag)) return { system: 'psx' };
    offset = u32be(entry, 8) * 2 ** 32 + u32be(entry, 12);
  }
  return { system: 'psx' };
}

// De qué consola es una ROM o una imagen de disco. `read(inicio, largo)` lee del archivo.
async function romSystem(read, size) {
  const b = await read(0, 0x10400);
  for (const at of [0, 0x10]) {
    const id = asciiAt(b, at, 16);
    if (id.startsWith('SEGADISCSYSTEM')) return { other: 'Mega CD' };
    if (id.startsWith('SEGA SEGASATURN')) return { other: 'Sega Saturn' };
    if (id.startsWith('SEGA SEGAKATANA')) return { other: 'Dreamcast' };
  }
  if (u32be(b, 0x1C) === 0xC2339F3D) return { other: 'GameCube' };
  if (u32be(b, 0x18) === 0x5D1C9EA3) return { other: 'Wii' };
  if (/^(WBFS|RVZ\x01|WIA\x01)/.test(asciiAt(b, 0, 4))) return { other: 'GameCube / Wii' };
  if (asciiAt(b, 0x10000, 20) === 'MICROSOFT*XBOX*MEDIA') return { other: 'Xbox' };
  if (asciiAt(b, 0, 8) === 'MComprHD') return chdSystem(read, b);
  if (asciiAt(b, 0, 4) === '\0PBP') return { system: 'psx' };
  return (await discSystem(read)) || cartridgeSystem(b, size);
}

/* Índice de un .7z: va al final del archivo y casi siempre comprimido con LZMA. Solo hacen falta los nombres. */

// Descompresor LZMA (el del índice de los .7z), según la especificación de Igor Pavlov (LzmaSpec.cpp, dominio público).
function lzmaDecode(input, props, outSize) {
  const lc = props[0] % 9, lp = Math.floor(props[0] / 9) % 5, pb = Math.floor(props[0] / 45);
  const out = new Uint8Array(outSize);
  let inPos = 1, outPos = 0, range = 0xFFFFFFFF, code = 0;
  const next = () => (inPos < input.length ? input[inPos++] : 0);
  for (let i = 0; i < 4; i++) code = code * 256 + next();
  const bit = (probs, i) => {
    const p = probs[i], bound = (range >>> 11) * p;
    let b;
    if (code < bound) { range = bound; probs[i] = p + ((2048 - p) >> 5); b = 0; }
    else { range -= bound; code -= bound; probs[i] = p - (p >> 5); b = 1; }
    if (range < 0x1000000) { range *= 256; code = code * 256 + next(); }
    return b;
  };
  const direct = n => {
    let res = 0;
    while (n--) {
      range = Math.floor(range / 2);
      const b = code >= range ? 1 : 0;
      if (b) code -= range;
      res = res * 2 + b;
      if (range < 0x1000000) { range *= 256; code = code * 256 + next(); }
    }
    return res;
  };
  const probs = n => new Uint16Array(n).fill(1024);
  const tree = (pr, base, bits) => { let m = 1; for (let i = 0; i < bits; i++) m = (m << 1) + bit(pr, base + m); return m - (1 << bits); };
  const reverse = (pr, base, bits) => {
    let m = 1, sym = 0;
    for (let i = 0; i < bits; i++) { const b = bit(pr, base + m); m = (m << 1) + b; sym |= b << i; }
    return sym;
  };
  const lenCoder = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });
  const decodeLen = (c, posState) => (!bit(c.choice, 0) ? tree(c.low, posState << 3, 3)
    : !bit(c.choice, 1) ? 8 + tree(c.mid, posState << 3, 3) : 16 + tree(c.high, 0, 8));
  const literal = probs(0x300 << (lc + lp)), isMatch = probs(192), isRep = probs(12), isRepG0 = probs(12);
  const isRepG1 = probs(12), isRepG2 = probs(12), isRep0Long = probs(192), posSlot = probs(4 << 6);
  const posCoders = probs(115), align = probs(16), lenDec = lenCoder(), repLenDec = lenCoder();
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  while (outPos < outSize) {
    const posState = outPos & ((1 << pb) - 1);
    if (!bit(isMatch, (state << 4) + posState)) {
      const prev = outPos ? out[outPos - 1] : 0;
      const base = 0x300 * (((outPos & ((1 << lp) - 1)) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        let match = out[outPos - rep0 - 1];
        while (sym < 0x100) {
          const mb = (match >> 7) & 1;
          match <<= 1;
          const b = bit(literal, base + ((1 + mb) << 8) + sym);
          sym = (sym << 1) | b;
          if (mb !== b) break;
        }
      }
      while (sym < 0x100) sym = (sym << 1) | bit(literal, base + sym);
      out[outPos++] = sym - 0x100;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (bit(isRep, state)) {
      if (!outPos) throw new Error('Datos LZMA dañados');
      if (!bit(isRepG0, state)) {
        if (!bit(isRep0Long, (state << 4) + posState)) {
          state = state < 7 ? 9 : 11;
          out[outPos] = out[outPos - rep0 - 1];
          outPos++;
          continue;
        }
      } else {
        let dist;
        if (!bit(isRepG1, state)) dist = rep1;
        else {
          if (!bit(isRepG2, state)) dist = rep2;
          else { dist = rep3; rep3 = rep2; }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = decodeLen(repLenDec, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0;
      len = decodeLen(lenDec, posState);
      state = state < 7 ? 7 : 10;
      const slot = tree(posSlot, Math.min(len, 3) << 6, 6);
      if (slot < 4) rep0 = slot;
      else {
        const bits = (slot >> 1) - 1;
        rep0 = (2 | (slot & 1)) * 2 ** bits;
        if (slot < 14) rep0 += reverse(posCoders, rep0 - slot, bits);
        else rep0 += direct(bits - 4) * 16 + reverse(align, 0, 4);
      }
      if (rep0 === 0xFFFFFFFF) break; // marca de fin
      if (rep0 >= outPos) throw new Error('Datos LZMA dañados');
    }
    for (len += 2; len > 0 && outPos < outSize; len--, outPos++) out[outPos] = out[outPos - rep0 - 1];
  }
  return out;
}

function sevenReader(bytes) {
  let p = 0;
  const r = {
    byte() {
      if (p >= bytes.length) throw new Error('El índice del .7z está dañado.');
      return bytes[p++];
    },
    // Números de 7-Zip: los bits altos del primer byte dicen cuántos bytes más siguen.
    num() {
      const first = r.byte();
      let mask = 0x80, value = 0;
      for (let i = 0; i < 8; i++) {
        if (!(first & mask)) return value + (first & (mask - 1)) * 2 ** (8 * i);
        value += r.byte() * 2 ** (8 * i);
        mask >>= 1;
      }
      return value;
    },
    bytes(n) {
      if (p + n > bytes.length) throw new Error('El índice del .7z está dañado.');
      p += n;
      return bytes.subarray(p - n, p);
    },
    rest: () => r.bytes(bytes.length - p),
    bits(n) {
      const out = [];
      for (let i = 0, cur = 0; i < n; i++) {
        if (i % 8 === 0) cur = r.byte();
        out.push(!!(cur & (0x80 >> (i % 8))));
      }
      return out;
    },
  };
  return r;
}

function sevenDigests(r, n) {
  const defined = r.byte() ? new Array(n).fill(true) : r.bits(n);
  for (const d of defined) if (d) r.bytes(4);
  return defined;
}

function sevenFolder(r) {
  const coders = [];
  let ins = 0, outs = 0;
  for (let n = r.num(); n > 0; n--) {
    const flag = r.byte();
    const id = [...r.bytes(flag & 0x0F)].map(x => x.toString(16).padStart(2, '0')).join('');
    const complex = flag & 0x10 ? [r.num(), r.num()] : [1, 1];
    const props = flag & 0x20 ? r.bytes(r.num()) : null;
    coders.push({ id, props });
    ins += complex[0];
    outs += complex[1];
  }
  const bound = [];
  for (let i = 1; i < outs; i++) { r.num(); bound.push(r.num()); }
  if (ins - outs + 1 > 1) for (let i = ins - outs + 1; i > 0; i--) r.num();
  return { coders, outs, bound, sizes: [], crc: false };
}
// Tamaño final de una carpeta de 7-Zip: el de la salida que no alimenta a otro filtro.
const sevenFolderSize = f => f.sizes.find((_, i) => !f.bound.includes(i)) ?? 0;

function sevenStreams(r) {
  const info = { packPos: 0, packSizes: [], folders: [], fileSizes: null };
  for (let id = r.num(); id !== 0; id = r.num()) {
    if (id === 0x06) { // PackInfo
      info.packPos = r.num();
      const n = r.num();
      for (let t = r.num(); t !== 0; t = r.num()) {
        if (t === 0x09) for (let i = 0; i < n; i++) info.packSizes.push(r.num());
        else if (t === 0x0A) sevenDigests(r, n);
        else throw new Error('Índice del .7z no compatible');
      }
    } else if (id === 0x07) { // UnpackInfo
      if (r.num() !== 0x0B) throw new Error('Índice del .7z no compatible');
      const n = r.num();
      if (r.byte()) throw new Error('Índice del .7z no compatible');
      for (let i = 0; i < n; i++) info.folders.push(sevenFolder(r));
      if (r.num() !== 0x0C) throw new Error('Índice del .7z no compatible');
      for (const f of info.folders) for (let i = 0; i < f.outs; i++) f.sizes.push(r.num());
      for (let t = r.num(); t !== 0; t = r.num()) {
        if (t !== 0x0A) throw new Error('Índice del .7z no compatible');
        sevenDigests(r, n).forEach((d, i) => { info.folders[i].crc = d; });
      }
    } else if (id === 0x08) { // SubStreamsInfo: cuántos archivos hay en cada carpeta y cuánto ocupa cada uno
      const counts = info.folders.map(() => 1);
      let t = r.num();
      if (t === 0x0D) { counts.forEach((_, i) => { counts[i] = r.num(); }); t = r.num(); }
      const sizes = [];
      info.folders.forEach((f, i) => {
        let sum = 0;
        for (let j = 1; j < counts[i] && t === 0x09; j++) { const s = r.num(); sizes.push(s); sum += s; }
        if (counts[i]) sizes.push(sevenFolderSize(f) - sum);
      });
      if (t === 0x09) t = r.num();
      for (; t !== 0; t = r.num()) {
        if (t !== 0x0A) throw new Error('Índice del .7z no compatible');
        sevenDigests(r, info.folders.reduce((n, f, i) => n + (counts[i] !== 1 || !f.crc ? counts[i] : 0), 0));
      }
      info.fileSizes = sizes;
    } else throw new Error('Índice del .7z no compatible');
  }
  info.fileSizes ??= info.folders.map(sevenFolderSize);
  return info;
}

function sevenFilesInfo(r) {
  const count = r.num();
  if (count > 1e6) throw new Error('El índice del .7z está dañado.');
  const files = Array.from({ length: count }, () => ({ name: '', empty: false, dir: false }));
  for (let t = r.num(); t !== 0; t = r.num()) {
    const p = sevenReader(r.bytes(r.num()));
    if (t === 0x0E) p.bits(files.length).forEach((e, i) => { files[i].empty = e; files[i].dir = e; });
    else if (t === 0x0F) {
      const emptyFile = p.bits(files.filter(f => f.empty).length);
      let k = 0;
      for (const f of files) if (f.empty) f.dir = !emptyFile[k++];
    } else if (t === 0x11 && !p.byte()) {
      const names = new TextDecoder('utf-16le').decode(p.rest()).split('\0');
      files.forEach((f, i) => { f.name = names[i] || ''; });
    }
  }
  return files;
}

async function sevenZipFiles(file) {
  const sig = await readBytes(file, 0, 32);
  if (!bytesAt(sig, 0, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])) throw new Error('No es un archivo .7z válido.');
  const offset = 32 + u32le(sig, 12) + u32le(sig, 16) * 2 ** 32, size = u32le(sig, 20) + u32le(sig, 24) * 2 ** 32;
  if (!size || size > 64 * MB || offset + size > file.size) throw new Error('El índice del .7z está dañado.');
  let r = sevenReader(await readBytes(file, offset, size));
  let id = r.num();
  if (id === 0x17) { // índice comprimido
    const info = sevenStreams(r);
    const folder = info.folders[0];
    if (!folder || folder.coders.length !== 1 || folder.coders[0].id !== '030101') throw new Error('Índice del .7z no compatible');
    const packed = await readBytes(file, 32 + info.packPos, info.packSizes[0]);
    r = sevenReader(lzmaDecode(packed, folder.coders[0].props, sevenFolderSize(folder)));
    id = r.num();
  }
  if (id !== 0x01) throw new Error('Índice del .7z no compatible');
  let sizes = [], files = [];
  for (let t = r.num(); t !== 0; t = r.num()) {
    if (t === 0x02) for (let p = r.num(); p !== 0; p = r.num()) r.bytes(r.num());
    else if (t === 0x03) sevenStreams(r);
    else if (t === 0x04) sizes = sevenStreams(r).fileSizes;
    else if (t === 0x05) files = sevenFilesInfo(r);
    else throw new Error('Índice del .7z no compatible');
  }
  let k = 0;
  return files.map(f => ({ name: f.name, dir: f.dir, size: f.empty ? 0 : sizes[k++] ?? 0 }));
}

// Nombres y tamaños de lo que hay dentro de un .rar (RAR 4 y RAR 5), leyendo solo sus cabeceras.
async function rarFiles(file) {
  const sig = await readBytes(file, 0, 8);
  const files = [];
  if (asciiAt(sig, 0, 7) === 'Rar!\x1A\x07\x00') {
    for (let p = 7, n = 0; p + 7 <= file.size && n < 5000; n++) {
      const base = await readBytes(file, p, 11);
      const type = base[2], flags = base[3] | (base[4] << 8), headSize = base[5] | (base[6] << 8);
      if (headSize < 7) break;
      if (type === 0x73 && flags & 0x80) throw new Error('El .rar tiene los nombres cifrados.');
      if (type === 0x7B) break;
      let data = flags & 0x8000 ? u32le(base, 7) : 0;
      if (type === 0x74) {
        const h = await readBytes(file, p, headSize);
        const large = flags & 0x100;
        data = u32le(h, 7) + (large ? u32le(h, 32) * 2 ** 32 : 0);
        const nameAt = large ? 40 : 32;
        const raw = h.subarray(nameAt, nameAt + (h[26] | (h[27] << 8)));
        const zero = raw.indexOf(0);
        files.push({
          name: new TextDecoder().decode(zero >= 0 ? raw.subarray(0, zero) : raw).replaceAll('\\', '/'),
          size: u32le(h, 11) + (large ? u32le(h, 36) * 2 ** 32 : 0),
          dir: (flags & 0xE0) === 0xE0,
        });
      }
      p += headSize + data;
    }
    return files;
  }
  if (asciiAt(sig, 0, 8) !== 'Rar!\x1A\x07\x01\x00') throw new Error('No es un archivo .rar válido.');
  // RAR 5: cada bloque es CRC (4 bytes), tamaño de la cabecera, la cabecera y, si los hay, sus datos.
  let q = 0;
  const vint = buf => {
    let value = 0, shift = 0, c;
    do { c = buf[q++] ?? 0; value += (c & 0x7F) * 2 ** shift; shift += 7; } while (c & 0x80 && shift < 64);
    return value;
  };
  for (let p = 8, n = 0; p < file.size && n < 5000; n++) {
    q = 0;
    const headSize = vint(await readBytes(file, p + 4, 4));
    const sizeLength = q;
    if (!headSize) break;
    const block = await readBytes(file, p + 4 + sizeLength, headSize);
    q = 0;
    const type = vint(block), flags = vint(block);
    if (flags & 1) vint(block);
    const data = flags & 2 ? vint(block) : 0;
    if (type === 4) throw new Error('El .rar tiene los nombres cifrados.');
    if (type === 5) break;
    if (type === 2) {
      const fileFlags = vint(block), size = vint(block);
      vint(block);
      if (fileFlags & 2) q += 4;
      if (fileFlags & 4) q += 4;
      vint(block);
      vint(block);
      const nameLength = vint(block);
      files.push({ name: new TextDecoder().decode(block.subarray(q, q + nameLength)), size, dir: !!(fileFlags & 1) });
    }
    p += 4 + sizeLength + headSize + data;
  }
  return files;
}

// Qué hay en un .zip, .7z o .rar con un juego. En los .zip se puede mirar el principio de cada archivo; en los
// .7z y .rar solo los nombres y tamaños (mirar dentro obligaría a descomprimirlo entero).
async function archiveGame(list) {
  const files = list.filter(f => !f.dir && !f.encrypted && f.name && !f.name.endsWith('/'))
    .map(f => ({ ...f, ext: extOf(f.name), base: f.name.split('/').pop().toLowerCase() }))
    .sort((a, b) => b.size - a.size);
  const rom = files.find(f => GAME_BY_EXT[f.ext]);
  if (rom) return { system: GAME_BY_EXT[rom.ext] };
  const unclear = files.filter(f => ['bin', 'iso', 'img', 'md', 'rom', 'chd', 'pbp', ''].includes(f.ext));
  for (const f of unclear.slice(0, 3)) {
    const head = f.head && await f.head(0x40000).catch(() => null);
    const found = head && await romSystem(async (start, length) => head.subarray(start, start + length), f.size);
    if (found) return found;
  }
  if (files.some(f => ['cue', 'm3u', 'ccd', 'chd', 'pbp'].includes(f.ext))) return { system: 'psx' };
  const other = files.find(f => OTHER_SYSTEMS[f.ext]);
  if (other) return { other: OTHER_SYSTEMS[other.ext] };
  if (!files.length || !files[0].head) {
    // Sin poder mirar dentro: un disco de PlayStation ocupa mucho más que un cartucho de Mega Drive.
    const big = unclear[0];
    if (big && big.ext !== 'md' && big.size > 16 * MB && big.size < 900 * MB) return { system: 'psx' };
    if (big && /^(bin|md)$/.test(big.ext) && big.size >= 128 * 1024 && big.size <= 10 * MB) return { system: 'segaMD' };
    return null;
  }
  // Juegos de PC y web: solo en .zip, que es lo que abren js-dos y el Baúl.
  if (files.some(f => f.base === 'index.html')) return { kind: 'web' };
  if (files.some(f => f.ext === 'pck' || f.base === 'project.binary')) return { kind: 'godot' };
  const programs = files.filter(f => ['exe', 'com', 'bat'].includes(f.ext));
  if (programs.some(f => f.ext !== 'exe')) return { kind: 'dos' };
  for (const f of programs.slice(0, 5)) {
    const head = await f.head(0x10000).catch(() => null);
    if (head && isDosHeader(head, f.size)) return { kind: 'dos' };
  }
  return null;
}

// De qué es un juego guardado: { system } (una consola del emulador), { kind: 'dos' | 'web' | 'godot' } (otros
// motores del Baúl), { other } (una consola que el Baúl no emula) o { hint } (falta algo para jugarlo). null si no se sabe.
async function detectGame(file, name) {
  const ext = extOf(name);
  if (GAME_BY_EXT[ext]) return { system: GAME_BY_EXT[ext] };
  if (OTHER_SYSTEMS[ext]) return { other: OTHER_SYSTEMS[ext] };
  if (ext === 'zip') return archiveGame(await readZip(file));
  if (ext === '7z') return archiveGame(await sevenZipFiles(file));
  if (ext === 'rar') return archiveGame(await rarFiles(file));
  if (ext === 'cue' || ext === 'm3u') return { hint: `Un .${ext} solo es la lista de pistas: para jugarlo, mete el .${ext} y sus archivos (.bin) en un mismo .zip.` };
  return romSystem((start, length) => readBytes(file, start, length), file.size);
}

// Lo detectado se recuerda (cifrado, con el resto de datos del archivo) para su icono y el filtro «Juegos».
async function gameOf(meta, file) {
  if (GAME_SYSTEMS[meta.system]) return { system: meta.system };
  if (PLAYABLE_KINDS.has(meta.system)) return { kind: meta.system };
  const found = await detectGame(file, meta.name).catch(() => null);
  const key = found?.system || found?.kind;
  const current = state.items.find(m => m.id === meta.id);
  // Si aún se está comprimiendo, no se toca: lo guardará el compresor (y se detectará otra vez al abrirlo).
  if (key && current && !current.status && !locked) {
    current.system = key;
    saveMeta(current).then(renderSoon, () => {});
  }
  return found;
}

// Botones del visor según lo detectado.
function gameActions(meta, file, found) {
  const ext = extOf(meta.name);
  const choose = label => {
    const b = el('button', 'open', label);
    b.onclick = () => chooseSystemAndPlay(meta, file);
    return b;
  };
  if (found?.system) {
    const play = el('button', 'play', 'Jugar');
    play.onclick = () => openGame(meta, found.system, file);
    return [play, el('div', 's', `Emulador de ${GAME_SYSTEMS[found.system].name} · detectado automáticamente`), choose('Elegir otra consola')];
  }
  if (found?.kind) {
    const run = el('button', 'play', 'Ejecutar');
    run.onclick = () => (found.kind === 'dos' ? openDos(meta, file) : found.kind === 'web' ? openWebApp(meta, file) : openGodotZip(meta, file));
    const what = { dos: 'Programa de MS-DOS', web: 'Juego web (HTML5)', godot: 'Juego hecho con Godot' }[found.kind];
    return [run, el('div', 's', `${what} · se abre aquí mismo`)];
  }
  const out = [];
  if (found?.other) out.push(el('p', 'why', `Es un juego de ${found.other}: el Baúl no tiene emulador para esa consola.`));
  if (found?.hint) out.push(el('p', 'why', found.hint));
  if (MAYBE_GAME_EXTS.has(ext)) out.push(choose(found?.other ? 'Elegir la consola a mano' : 'Jugar con un emulador…'));
  return out;
}

/* ---- Juegos: emulador integrado ---- */

const emu = $('#emu');
let emuSession = null;

async function chooseSystemAndPlay(meta, file) {
  const options = Object.entries(GAME_SYSTEMS).map(([key, s]) => ({ label: s.name, value: key }));
  if (extOf(meta.name) === 'zip') {
    options.push({ label: 'PC antiguo (MS-DOS)', sub: 'Juegos y programas de antes de Windows 95', value: 'dos' });
    options.push({ label: 'Juego web (HTML5)', sub: 'Un .zip con un index.html dentro', value: 'web' });
    options.push({ label: 'Juego hecho con Godot', sub: 'Un .zip con el .pck (o el .exe) del juego', value: 'godot' });
  }
  const system = await menu('¿De qué sistema es el juego?', options,
    'Los .zip o .7z con el juego dentro también valen. Para PlayStation, mete el .cue y el .bin en un mismo .zip.');
  if (system === 'dos') openDos(meta, file);
  else if (system === 'web') openWebApp(meta, file);
  else if (system === 'godot') openGodotZip(meta, file);
  else if (system) openGame(meta, system, file);
}

async function openGame(meta, system, file) {
  // La extensión importa (el núcleo de Sega elige entre Mega Drive, Master System y Game Gear por ella): si el
  // archivo no trae la de su consola (una ROM sin extensión, un .bin de Master System…), se le pone la suya.
  let ext = extOf(meta.name);
  const keep = GAME_SYSTEMS[system].exts.includes(ext) || ['zip', '7z', 'rar'].includes(ext)
    || (system === 'psx' && ['bin', 'iso', 'img', 'chd', 'cue'].includes(ext)) || (system === 'segaMD' && ext === 'bin');
  if (!keep) {
    const magic = asciiAt(await readBytes(file, 0, 8), 0, 8);
    ext = magic === 'MComprHD' ? 'chd' : magic.startsWith('\0PBP') ? 'pbp' : system === 'psx' ? 'bin' : GAME_SYSTEMS[system].exts[0];
  }
  // El emulador guarda sus partidas con este nombre: un identificador, para no dejar el nombre del juego sin cifrar.
  openPlayer(meta, 'emulator.html', { type: 'start', core: system, game: file, name: `${meta.id}.${ext}` });
}

// Abre un emulador (página aislada) a pantalla completa y le pasa el juego cuando está listo.
// `saveId`: las partidas de MS-DOS se guardan cifradas en el baúl, con la llave de esta sesión.
// `web`: una app web (HTML5) servida desde la copia temporal; no puede salir del visor ni abrir ventanas.
// `staged`: el juego se sirve desde la copia temporal descifrada, que se borra al cerrar.
function openPlayer(meta, page, start, { saveId = null, web = false, staged = web } = {}) {
  closeGame(false);
  const frame = el('iframe');
  frame.title = meta.name;
  frame.allow = 'autoplay; gamepad; fullscreen';
  if (web) frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock';
  frame.src = page;
  const onMessage = e => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    if (e.data?.type === 'ready' && start) frame.contentWindow.postMessage(start, location.origin);
    // El juego terminó (o no pudo arrancar): se cierra el visor y, si hubo errores, se explican.
    if (e.data?.type === 'exit') {
      closeGame(false);
      if (e.data.errors?.length) ask({ title: 'El juego se cerró', message: e.data.errors.join('\n'), cancel: null });
    }
    if (e.data?.type === 'problems') toast('Este juego da errores al cargar: puede que no funcione bien');
  };
  window.addEventListener('message', onMessage);
  emuSession = { frame, onMessage, saveId, web, staged, key: masterKey };
  $('#emuTitle').textContent = meta.name;
  $('#emuHost').replaceChildren(frame);
  emu.hidden = false;
  document.documentElement.classList.add('noscroll');
}

// Cierra el juego; antes pide al emulador que guarde la memoria del cartucho (o el disco de MS-DOS).
async function closeGame(save = true) {
  const session = emuSession;
  if (!session) return;
  emuSession = null;
  if (save && !session.web && session.frame.contentWindow) {
    const changes = await new Promise(resolve => {
      const done = e => { if (e.source === session.frame.contentWindow && e.data?.type === 'saved') finish(e.data.changes); };
      const finish = value => { window.removeEventListener('message', done); clearTimeout(timer); resolve(value); };
      const timer = setTimeout(finish, session.saveId ? 4000 : 800);
      window.addEventListener('message', done);
      session.frame.contentWindow.postMessage({ type: 'save' }, location.origin);
    });
    if (session.saveId && changes?.length) {
      await storeDosChanges(session.saveId, changes, session.key).catch(err => toast(`No se pudo guardar la partida: ${err.message || err}`));
    }
  }
  window.removeEventListener('message', session.onMessage);
  $('#emuHost').replaceChildren();
  // La copia descifrada del juego no se queda en el iPhone.
  if (session.staged) clearRunCache();
  emu.hidden = true;
  if (viewer.hidden) document.documentElement.classList.remove('noscroll');
}
$('#emuClose').addEventListener('click', () => closeGame());

// Partidas guardadas por el emulador (van aparte, sin nombres de juegos): se borran al vaciar el baúl.
const clearGameSaves = () => Promise.all([
  new Promise(resolve => {
    const r = indexedDB.deleteDatabase('EmulatorJS-states');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  }),
  // Partidas de los juegos de Godot (su carpeta user://) y de Ren'Py.
  ...['/userfs', '/home/web_user/.renpy', '/home/web_user/love'].map(name => new Promise(resolve => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  })),
  clearWebAppData(null),
]);

/* ---- MS-DOS: programas y juegos de PC antiguos, con js-dos (DOSBox) ---- */

const ANDROID_EXTS = new Set(['apk', 'xapk', 'apks', 'aab']);

// Un .exe de Windows lleva la firma «PE» (o «NE» si es de Windows 3.x) tras la cabecera de MS-DOS.
// `head`: el principio del .exe (64 KB bastan); `size`: lo que ocupa entero.
function isDosHeader(head, size) {
  const mz = (head[0] === 0x4d && head[1] === 0x5a) || (head[0] === 0x5a && head[1] === 0x4d);
  if (!mz || head.length < 28) return false;
  if (head.length < 64) return true;
  const next = u32le(head, 0x3c);
  if (next < 64 || next + 2 > size || next + 2 > head.length) return true;
  const sig = asciiAt(head, next, 2);
  return sig !== 'PE' && sig !== 'NE';
}
async function isDosProgram(meta, file) {
  const ext = extOf(meta.name);
  if (ext !== 'exe') return DOS_EXTS.has(ext);
  return isDosHeader(await readBytes(file, 0, 0x10000), file.size);
}

// Nombres al estilo de MS-DOS (8.3): «Mi Juego.exe» → «MIJUEGO.EXE».
const DOS_CHARS = "A-Za-z0-9_\\-!#$%&'(){}@^`~";
const isDosName = name => new RegExp(`^[${DOS_CHARS}]{1,8}(\\.[${DOS_CHARS}]{1,3})?$`).test(name);
function dosName(name, taken = new Set()) {
  const dot = name.lastIndexOf('.');
  const clean = t => t.toUpperCase().replace(new RegExp(`[^${DOS_CHARS}]`, 'g'), '');
  const base = clean(dot > 0 ? name.slice(0, dot) : name).slice(0, 8) || 'ARCHIVO';
  const ext = dot > 0 ? clean(name.slice(dot + 1)).slice(0, 3) : '';
  const full = b => b + (ext ? `.${ext}` : '');
  let out = full(base);
  for (let n = 1; taken.has(out); n++) out = full(base.slice(0, 7 - String(n).length) + '~' + n);
  taken.add(out);
  return out;
}
// Renombra todas las rutas de un .zip a 8.3, de forma coherente carpeta a carpeta.
function dosPaths(paths) {
  const dirs = new Map([['', '']]);
  const taken = new Map();
  const part = (parent, name) => {
    if (!taken.has(parent)) taken.set(parent, new Set());
    return dosName(name, taken.get(parent));
  };
  const join = (dir, name) => (dir ? `${dir}/${name}` : name);
  const dirOf = path => {
    if (!dirs.has(path)) {
      const i = path.lastIndexOf('/');
      const parent = dirOf(i < 0 ? '' : path.slice(0, i));
      dirs.set(path, join(parent, part(parent, path.slice(i + 1))));
    }
    return dirs.get(path);
  };
  return paths.map(path => {
    const i = path.lastIndexOf('/');
    const dir = dirOf(i < 0 ? '' : path.slice(0, i));
    return join(dir, part(dir, path.slice(i + 1)));
  });
}

const DOS_CONF = `[sdl]
autolock=false

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cputype=auto
cycles=auto

[autoexec]
@echo off
mount c .
c:
cls
`;

// Prepara el disco C: (un .zip que js-dos descomprime) y la orden que abre el programa.
async function dosStart(meta, file) {
  const ext = extOf(meta.name);
  const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
  if (ext !== 'zip' && ext !== 'jsdos') {
    const name = dosName(meta.name);
    const disk = await buildZip([{ name, blob: file, date: new Date() }]);
    return { files: [await bytes(disk)], conf: DOS_CONF + name + '\n' };
  }
  const entries = (await readZip(file))
    .map(e => Object.assign(e, { path: e.name.replace(/\\/g, '/') }))
    .filter(e => !e.path.endsWith('/') && !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(e.path));
  if (entries.some(e => e.encrypted)) throw new Error('El .zip tiene contraseña. Descomprímelo y vuelve a comprimirlo sin ella.');
  // Paquete de js-dos (.jsdos o .zip): trae su propia configuración.
  const own = entries.find(e => e.path.toLowerCase() === '.jsdos/dosbox.conf');
  if (own) return { files: [await bytes(file)], conf: await (await own.blob()).text() };

  const programs = entries.filter(e => /\.(exe|com|bat)$/i.test(e.path));
  if (!programs.length) throw new Error('No hay ningún programa de MS-DOS (.exe, .com o .bat) dentro del .zip.');
  // Primero el que parece el juego; los instaladores y utilidades, al final.
  const rank = path => (/(^|\/)(setup|install|instal|uninst|config|setsound|sound|patch)[^/]*$/i.test(path) ? 1 : 0) + path.split('/').length / 100;
  programs.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  let chosen = programs[0];
  if (programs.length > 1) {
    chosen = await menu('¿Qué programa quieres abrir?', programs.slice(0, 80).map(e => ({
      label: e.path.split('/').pop(), sub: e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : undefined, value: e,
    })), 'Suele ser el que lleva el nombre del juego. SETUP o INSTALL sirven para configurar el sonido.');
    if (!chosen) return null;
  }

  let files;
  let target = chosen.path;
  if (entries.every(e => e.path.split('/').every(isDosName))) {
    files = [await bytes(file)];
  } else {
    // Nombres largos o con acentos: MS-DOS no los entiende, así que se acortan (8.3) en una copia temporal.
    const paths = dosPaths(entries.map(e => e.path));
    const list = [];
    for (let i = 0; i < entries.length; i++) list.push({ name: paths[i], blob: await entries[i].blob(), date: new Date() });
    files = [await bytes(await buildZip(list))];
    target = paths[entries.indexOf(chosen)];
  }
  const dir = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
  return { files, conf: DOS_CONF + (dir ? `cd \\${dir.replace(/\//g, '\\')}\n` : '') + target.split('/').pop() + '\n' };
}

async function openDos(meta, file) {
  let start;
  try {
    start = await dosStart(meta, file);
    if (!start) return;
    const saved = await loadDosChanges(meta.id);
    if (saved) start.files.push(saved);
  } catch (err) {
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
    return;
  }
  if (!locked) openPlayer(meta, 'dos.html', { type: 'start', ...start }, { saveId: meta.id });
}

// Lo que el programa escribe en su disco (partidas, configuración…) se guarda cifrado junto a él.
function dosSaveKey(id) { return `dos:${id}`; }
async function loadDosChanges(id, key = masterKey) {
  const sealed = await dbBlob(dosSaveKey(id));
  return sealed ? new Uint8Array(await (await decryptBlob(sealed, key)).arrayBuffer()) : null;
}
async function storeDosChanges(id, changes, key) {
  const files = new Map();
  const add = async zip => {
    for (const e of await readZip(new Blob([zip]))) {
      // La configuración la pone el Baúl al abrir: solo se guardan los archivos del programa.
      if (e.name.endsWith('/') || e.name.startsWith('.jsdos/')) continue;
      files.set(e.name.toUpperCase(), { name: e.name, blob: await e.blob(), date: new Date() });
    }
  };
  await add(changes);
  if (!files.size) return;
  const fresh = new Map(files);
  files.clear();
  const before = await loadDosChanges(id, key);
  if (before) await add(before);
  for (const [k, v] of fresh) files.set(k, v);
  const sealed = await encryptBlob(await buildZip([...files.values()]), key);
  // Solo si el programa sigue en el baúl (pudo borrarse mientras tanto).
  await tx(['meta', 'blobs'], 'readwrite', (m, b) => {
    const g = m.get(id);
    g.onsuccess = () => { if (g.result) b.put(sealed, dosSaveKey(id)); };
  });
}

/* ---- Juegos hechos con Godot (.apk, .pck o .exe): el motor web oficial de la misma versión (ver godot.html) ---- */

// Versión del motor web que abre cada versión de Godot: los scripts compilados solo los entiende la suya.
function godotRuntime(major, minor) {
  if (major === 3) return '3.6.3';
  if (major !== 4) return null;
  if (minor <= 3) return '4.3';
  return minor === 4 ? '4.4.1' : '4.7.2';
}
const GODOT_PACK_MAGIC = 0x43504447; // «GDPC»

// En un .apk de Godot, los archivos del juego van sueltos en assets/ junto a project.binary (o en un .pck).
async function godotApkInfo(files) {
  const project = files.find(e => /(^|\/)assets\/project\.binary$/.test(e.name));
  if (!project) {
    const pack = files.find(e => /(^|\/)assets\/[^/]+\.pck$/i.test(e.name));
    return pack ? godotPackInfo(await pack.blob()) : null;
  }
  const root = project.name.slice(0, -'project.binary'.length);
  const game = files.filter(e => e.name.startsWith(root) && !e.name.startsWith(`${root}dexopt/`));
  // Godot 4 escribe su versión («4.4») en la configuración del proyecto.
  const settings = new TextDecoder('latin1').decode(await (await project.blob()).arrayBuffer());
  const feature = /config\/features[\s\S]{0,64}?\x00(\d)\.(\d+)\x00/.exec(settings);
  const major = feature ? Number(feature[1]) : game.some(e => e.name.startsWith(`${root}.godot/`)) ? 4 : 3;
  let minor = feature ? Number(feature[2]) : null;
  if (major === 4 && minor === null) {
    // Sin versión escrita: la delatan los scripts compilados (100 = Godot 4.3/4.4, 101 = 4.5 o más).
    const gdc = game.find(e => e.name.endsWith('.gdc'));
    const tokens = gdc ? new DataView(await (await gdc.blob()).slice(4, 8).arrayBuffer()).getUint32(0, true) : 0;
    minor = tokens >= 101 ? 7 : tokens === 100 ? 4 : 3;
  }
  const runtime = godotRuntime(major, minor);
  if (!runtime) return null;
  return { godot: runtime, version: minor === null ? `${major}` : `${major}.${minor}`, files: game.map(e => ({ path: e.name.slice(root.length), entry: e })) };
}

// Lee el índice de un .pck de Godot, suelto o pegado al final de un .exe.
async function godotPackInfo(blob) {
  const u32At = async at => new DataView(await blob.slice(at, at + 4).arrayBuffer()).getUint32(0, true);
  if (blob.size < 100) return null;
  let start = 0;
  if (await u32At(0) !== GODOT_PACK_MAGIC) {
    const tail = new DataView(await blob.slice(blob.size - 12).arrayBuffer());
    if (tail.getUint32(8, true) !== GODOT_PACK_MAGIC) return null;
    start = blob.size - 12 - Number(tail.getBigUint64(0, true));
    if (start < 0 || await u32At(start) !== GODOT_PACK_MAGIC) return null;
  }
  const head = new DataView(await blob.slice(start, start + 128).arrayBuffer());
  const format = head.getUint32(4, true);
  const major = head.getUint32(8, true);
  const minor = head.getUint32(12, true);
  let flags = 0;
  let base = start;
  let dir;
  if (format === 1) {
    dir = start + 20 + 64;
  } else if (format === 2) {
    flags = head.getUint32(20, true);
    const fileBase = Number(head.getBigUint64(24, true));
    base = flags & 2 ? start + fileBase : fileBase;
    dir = start + 32 + 64;
  } else if (format === 3 || format === 4) {
    flags = head.getUint32(20, true);
    base = start + Number(head.getBigUint64(24, true));
    dir = start + Number(head.getBigUint64(32, true));
  } else {
    throw new Error('Este juego es de una versión de Godot que el Baúl todavía no conoce.');
  }
  if (flags & 1) throw new Error('Este juego de Godot está cifrado por su autor y no se puede abrir.');
  if (flags & 4) throw new Error('Este juego de Godot viene repartido en varios archivos y no se puede abrir así.');
  const runtime = godotRuntime(major, minor);
  if (!runtime) throw new Error(`Está hecho con Godot ${major}, que el Baúl todavía no puede abrir (sí abre los de Godot 3 y 4).`);

  // El índice ocupa poco: se lee por bloques hasta tenerlo entero.
  let size = Math.min(blob.size - dir, 1 << 20);
  for (;;) {
    const view = new DataView(await blob.slice(dir, dir + size).arrayBuffer());
    try {
      const td = new TextDecoder();
      const count = view.getUint32(0, true);
      const files = [];
      let p = 4;
      for (let i = 0; i < count; i++) {
        const len = view.getUint32(p, true);
        const path = td.decode(new Uint8Array(view.buffer, p + 4, len)).replace(/\0+$/, '').replace(/^res:\/\//, '');
        p += 4 + len;
        let ofs = Number(view.getBigUint64(p, true));
        const length = Number(view.getBigUint64(p + 8, true));
        p += 32;
        let fileFlags = 0;
        if (format >= 2) { fileFlags = view.getUint32(p, true); p += 4; }
        if (fileFlags & 1) throw new Error('Este juego de Godot está cifrado por su autor y no se puede abrir.');
        if (fileFlags & 2) continue; // archivo borrado por un parche
        // Godot 3 guarda posiciones desde el principio del archivo cuando el juego va pegado al .exe.
        if (format === 1 && !(start && ofs >= start)) ofs += start;
        else if (format >= 2) ofs += base;
        files.push({ path, blob: blob.slice(ofs, ofs + length) });
      }
      return { godot: runtime, version: `${major}.${minor}`, files };
    } catch (err) {
      if (!(err instanceof RangeError) || size >= blob.size - dir) throw err;
      size = Math.min(blob.size - dir, size * 4);
    }
  }
}

// Las texturas vienen preparadas para una plataforma (móvil o PC): se apunta a la que existe de verdad.
async function fixGodotImport(blob, have) {
  const text = await blob.text();
  const line = /^path\.\w+="res:\/\/([^"]+)"[ \t\r]*$/gm;
  const found = [...text.matchAll(line)].map(m => m[1]).find(p => have.has(p));
  if (!found) return blob;
  let first = true;
  return new Blob([text.replace(line, () => (first ? ((first = false), `path="res://${found}"`) : ''))]);
}

// Monta el .pck que espera el motor web, con los mismos archivos del juego.
async function buildGodotPack(files, runtime, onProgress) {
  const [major, minor, patch = 0] = runtime.split('.').map(Number);
  const v2 = major >= 4;
  const enc = new TextEncoder();
  const pad = (n, a) => (a - (n % a)) % a;
  const have = new Set(files.map(f => f.path));
  const items = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i / files.length);
    let blob = files[i].blob || await files[i].entry.blob();
    if (files[i].path.endsWith('.import')) blob = await fixGodotImport(blob, have);
    items.push({ name: enc.encode(`res://${files[i].path}`), blob });
  }
  let base = (v2 ? 32 : 20) + 64 + 4 + items.reduce((n, it) => n + 4 + it.name.length + pad(it.name.length, 4) + 32 + (v2 ? 4 : 0), 0);
  base += pad(base, 32);
  const head = new Uint8Array(base);
  const view = new DataView(head.buffer);
  let p = 0;
  const u32 = v => { view.setUint32(p, v, true); p += 4; };
  const u64 = v => { view.setBigUint64(p, BigInt(v), true); p += 8; };
  u32(GODOT_PACK_MAGIC);
  u32(v2 ? 2 : 1);
  u32(major); u32(minor); u32(patch);
  if (v2) { u32(2); u64(base); } // posiciones relativas al principio del .pck
  p += 64;
  u32(items.length);
  const parts = [head];
  let off = 0;
  for (const it of items) {
    const len = it.name.length + pad(it.name.length, 4);
    u32(len);
    head.set(it.name, p);
    p += len;
    u64(v2 ? off : base + off);
    u64(it.blob.size);
    p += 16; // md5 (no se comprueba)
    if (v2) u32(0);
    const gap = pad(it.blob.size, 32);
    parts.push(it.blob);
    if (gap) parts.push(new Uint8Array(gap));
    off += it.blob.size + gap;
  }
  return new Blob(parts);
}

async function openGodot(meta, info) {
  if (busy) return;
  busy = true;
  let pack;
  try {
    pack = await buildGodotPack(info.files, info.godot, f => showProgress('Preparando el juego…', meta.name, f));
  } catch (err) {
    hideProgress();
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
    return;
  } finally {
    busy = false;
    hideProgress();
  }
  if (!locked) openPlayer(meta, 'godot.html', { type: 'start', runtime: info.godot, pack });
}

// Un .zip con un juego de Godot para PC: su .pck, o el .exe que lo lleva dentro.
async function openGodotZip(meta, file) {
  let info = null;
  try {
    const entries = (await readZip(file)).filter(e => !e.name.endsWith('/'));
    const candidates = [...entries.filter(e => /\.pck$/i.test(e.name)), ...entries.filter(e => /\.(exe|x86_64|bin)$/i.test(e.name))];
    for (const entry of candidates) {
      info = await godotPackInfo(await entry.blob());
      if (info) break;
    }
  } catch (err) {
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
    return;
  }
  if (!info) ask({ title: 'No se puede abrir', message: 'No hay ningún juego de Godot (.pck) dentro del .zip.', cancel: null });
  else openGodot(meta, info);
}

/* ---- Novelas visuales hechas con Ren'Py (.apk): el motor web oficial de Ren'Py (ver renpy.html) ---- */

// Motores web: uno para Ren'Py 8 (Python 3) y otro para Ren'Py 7 (Python 2). Cada uno abre su página.
const RENPY_RUNTIMES = { 8: '8.5.3', 7: '7.8.7' };
const renpyPage = runtime => (runtime.startsWith('7') ? `vendor/renpy-${runtime}/index.html` : 'renpy.html');

// Lee un archivo de un .tar.gz (como private.mp3, donde Ren'Py guarda su código en Android) sin descomprimirlo entero.
async function readTarGzFile(blob, wanted) {
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let buf = new Uint8Array(0);
  let need = 512;
  let pending = null; // { name, size }
  const td = new TextDecoder();
  for (;;) {
    while (buf.length < need) {
      const { done, value } = await reader.read();
      if (done) return null;
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
    }
    if (!pending) {
      const header = buf.subarray(0, 512);
      const name = td.decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
      if (!name) return null;
      const prefix = td.decode(header.subarray(345, 500)).replace(/\0.*$/s, '');
      const size = parseInt(td.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0', 8);
      buf = buf.subarray(512);
      pending = { name: prefix ? `${prefix}/${name}` : name, size };
      need = Math.ceil(size / 512) * 512;
    } else {
      if (pending.name === wanted) { reader.cancel(); return buf.subarray(0, pending.size); }
      buf = buf.subarray(need);
      pending = null;
      need = 512;
    }
  }
}

// En un .apk de Ren'Py, el juego va en assets/x-game (a cada nombre se le añade «x-») y el motor en private.mp3.
async function renpyApkInfo(files) {
  const priv = files.find(e => /(^|\/)assets\/private\.mp3$/.test(e.name));
  const root = priv ? priv.name.slice(0, -'private.mp3'.length) : null;
  const game = root ? files.filter(e => e.name.startsWith(`${root}x-game/`)) : [];
  if (!game.length) return null;
  let version = '';
  try {
    const vc = await readTarGzFile(await priv.blob(), 'renpy/vc_version.py');
    version = /version\s*=\s*u?['"](\d+\.\d+)/.exec(new TextDecoder().decode(vc || new Uint8Array()))?.[1] || '';
  } catch { /* sin versión: se prueba con el motor actual */ }
  const major = Number(version.split('.')[0]) || 8;
  if (!RENPY_RUNTIMES[major]) return { engine: `Ren'Py ${version}` };
  const unx = part => (part.startsWith('x-') ? part.slice(2) : part);
  return {
    renpy: RENPY_RUNTIMES[major],
    version: version || '8',
    files: game.map(e => ({ path: e.name.slice(root.length).split('/').map(unx).join('/'), entry: e })),
  };
}

// Junta el motor (renpy/ y main.py de la misma versión) con los archivos del juego en el game.zip que espera la web.
async function openRenpy(meta, info) {
  if (busy) return;
  busy = true;
  let zip;
  try {
    showProgress('Preparando el juego…', meta.name, 0);
    const res = await fetch(`vendor/renpy-${info.renpy}/renpy-engine.zip`);
    if (!res.ok) throw new Error('No se pudo cargar el motor de Ren\'Py. Ábrelo una vez con internet para guardarlo en el iPhone.');
    const engine = (await readZip(await res.blob())).filter(e => !e.name.endsWith('/'));
    const list = [];
    const total = engine.length + info.files.length;
    for (const e of engine) list.push({ name: e.name, blob: await e.blob(), date: new Date() });
    for (let i = 0; i < info.files.length; i++) {
      showProgress('Preparando el juego…', meta.name, (engine.length + i) / total);
      list.push({ name: info.files[i].path, blob: await info.files[i].entry.blob(), date: new Date() });
    }
    zip = await buildZip(list, (i, n) => showProgress('Preparando el juego…', meta.name, 0.5 + i / n / 2));
  } catch (err) {
    hideProgress();
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
    return;
  } finally {
    busy = false;
    hideProgress();
  }
  if (!locked) openPlayer(meta, renpyPage(info.renpy), { type: 'start', runtime: info.renpy, zip });
}

/* ---- Juegos hechos con LÖVE (Lua) y con Flash / Adobe AIR ---- */

// LÖVE en Android: el juego va en assets/game.love (o suelto en assets/, con su main.lua).
function loveApkInfo(files) {
  const love = files.find(e => /(^|\/)assets\/game\.love$/.test(e.name));
  if (love) return { love };
  if (!files.some(e => /\/liblove\.so$/.test(e.name))) return null;
  const main = files.find(e => /(^|\/)assets\/main\.lua$/.test(e.name));
  if (!main) return null;
  const root = main.name.slice(0, -'main.lua'.length);
  return { love: files.filter(e => e.name.startsWith(root)).map(e => ({ path: e.name.slice(root.length), entry: e })) };
}

async function openLove(meta, info) {
  if (busy) return;
  busy = true;
  let game = info.love;
  try {
    if (Array.isArray(game)) {
      // Juego suelto: se empaqueta como .love (un .zip con main.lua en la raíz).
      const list = [];
      for (let i = 0; i < game.length; i++) {
        showProgress('Preparando el juego…', meta.name, i / game.length / 2);
        list.push({ name: game[i].path, blob: await game[i].entry.blob(), date: new Date() });
      }
      game = await buildZip(list, (i, n) => showProgress('Preparando el juego…', meta.name, 0.5 + i / n / 2));
    } else if (typeof game.blob === 'function') {
      game = await game.blob();
    }
  } catch (err) {
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
    return;
  } finally {
    busy = false;
    hideProgress();
  }
  if (!locked) openPlayer(meta, 'love.html', { type: 'start', game });
}

// Adobe AIR en Android: el .swf principal lo indica META-INF/AIR/application.xml, dentro de assets/.
async function airApkInfo(files) {
  const xml = files.find(e => /(^|\/)assets\/META-INF\/AIR\/application\.xml$/.test(e.name));
  if (!xml) return null;
  const root = xml.name.slice(0, -'META-INF/AIR/application.xml'.length);
  const main = /<content>\s*([^<]+?)\s*<\/content>/.exec(await (await xml.blob()).text())?.[1];
  if (!main) return null;
  return { flash: true, root, main, files: files.filter(e => e.name.startsWith(root) && !e.name.startsWith(`${root}META-INF/`)) };
}

// Flash con Ruffle: un .swf suelto se le pasa tal cual; un juego de AIR se sirve desde la copia temporal.
async function openFlash(meta, info) {
  if (info.swf) {
    // Ruffle guarda las partidas con el nombre del .swf: un identificador, para no dejar el nombre del juego sin cifrar.
    openPlayer(meta, 'flash.html', { type: 'start', swf: info.swf, name: `${meta.id}.swf` });
    return;
  }
  if (busy) return;
  busy = true;
  let base = null;
  try {
    base = await stageRunFiles(meta, info.files, info.root);
  } catch (err) {
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
  } finally {
    busy = false;
    hideProgress();
  }
  if (!base || locked) await clearRunCache();
  else openPlayer(meta, 'flash.html', { type: 'start', url: new URL(info.main, base).href }, { staged: true });
}

/* ---- Apps y juegos web (HTML5): los .apk que llevan una web dentro, o un .zip con un index.html ---- */

// Con qué está hecho un .apk que no es web (y por tanto necesita Android de verdad).
const APK_ENGINES = [
  [/(^|\/)assets\/bin\/Data\/|\/libunity\.so$/, 'Unity'],
  [/\/lib(UE4|Unreal)\.so$/i, 'Unreal Engine'],
  [/\/libgodot_android\.so$|(^|\/)assets\/[^/]+\.pck$/, 'Godot'],
  [/\/liblove\.so$/, 'LÖVE'],
  [/\/libcocos/, 'Cocos'],
  [/\/libgdx\.so$/, 'libGDX'],
  [/\/libyoyo\.so$/, 'GameMaker'],
  [/\/libflutter\.so$/, 'Flutter'],
  [/\/libreactnativejni\.so$|(^|\/)assets\/index\.android\.bundle$/, 'React Native'],
  [/\/libmonodroid\.so$/, 'Xamarin'],
  [/(^|\/)META-INF\/AIR\//, 'Adobe AIR'],
];
function nativeApkReason(engine) {
  if (/^Ren'Py [1-6]/.test(engine || '')) return `Está hecha con ${engine}, una versión muy antigua que el Baúl todavía no puede abrir (sí abre las de Ren'Py 7 y 8).`;
  if (engine === 'Godot 2') return 'Está hecho con Godot 2, una versión muy antigua del motor que el Baúl todavía no puede abrir (sí abre los de Godot 3 y 4).';
  const what = engine ? `Está hecha con ${engine}` : 'Es una app nativa de Android';
  return `${what}: necesita Android de verdad, y Safari no deja ejecutar ese código en el iPhone. ` +
    'El Baúl abre por dentro los juegos de Android hechos con Godot, Ren\'Py, LÖVE, Flash (Adobe AIR) o tecnología web (HTML5), y este no lo es.';
}

// Qué trae un .apk (también dentro de .xapk/.apks, que llevan varios .apk) o un .zip: un juego de Godot, Ren'Py,
// LÖVE o Adobe AIR, una web (HTML5), o una app nativa que necesita Android.
async function inspectApp(meta, file) {
  let entries = await readZip(file);
  if (!entries.some(e => /(^|\/)AndroidManifest\.xml$/.test(e.name))) {
    // Paquete con varios .apk dentro: el principal es el que trae la carpeta assets/.
    const outer = entries;
    for (const inner of outer.filter(e => /\.apk$/i.test(e.name))) {
      const sub = await readZip(await inner.blob());
      if (sub.some(e => /(^|\/)assets\//.test(e.name))) { entries = sub; break; }
    }
    // Los juegos grandes traen el resto de sus archivos en un .obb (otro .zip con la misma carpeta assets/).
    for (const obb of outer.filter(e => /\.obb$/i.test(e.name))) {
      entries = entries.concat(await readZip(await obb.blob()));
    }
  }
  const files = entries.filter(e => !e.name.endsWith('/') && !/(^|\/)__MACOSX\//.test(e.name));
  const isApp = files.some(e => /(^|\/)AndroidManifest\.xml$/.test(e.name));
  if (isApp) {
    if (files.some(e => /(^|\/)assets\/engine\.cfb$/.test(e.name))) return { engine: 'Godot 2' };
    const godot = await godotApkInfo(files);
    if (godot) return godot;
    const renpy = await renpyApkInfo(files);
    if (renpy) return renpy;
    const love = loveApkInfo(files);
    if (love) return love;
    const air = await airApkInfo(files);
    if (air) return air;
  }
  const engine = APK_ENGINES.find(([re]) => files.some(e => re.test(e.name)))?.[1];
  if (isApp && engine) return { engine };
  // La página principal más cercana a la raíz (en un .apk, dentro de assets/).
  const pages = files.map(e => e.name)
    .filter(n => /(^|\/)index\.html?$/i.test(n) && (!isApp || /(^|\/)assets\//.test(n)))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  if (!pages.length) return { engine };
  const root = pages[0].slice(0, pages[0].lastIndexOf('/') + 1);
  return { root, page: pages[0].slice(root.length), files: files.filter(e => e.name.startsWith(root)) };
}

// La misma forma que usa el service worker para buscar el archivo (ver sw.js).
function runUrl(href) {
  const url = new URL(href);
  const decode = part => { try { return decodeURIComponent(part); } catch { return part; } };
  return url.origin + url.pathname.split('/').map(p => encodeURIComponent(decode(p))).join('/');
}
const RUN_CACHE = 'baul-run';
const clearRunCache = () => (self.caches ? caches.delete(RUN_CACHE).catch(() => {}) : Promise.resolve());
const WEB_MIME = { ...EXT_MIME, wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mid: 'audio/midi', midi: 'audio/midi', swf: 'application/x-shockwave-flash' };

// Copia los archivos descifrados de una app a la caché temporal (se borra al cerrar) y devuelve su dirección.
// A las páginas HTML se les añade apk-shim.js antes que cualquier script de la app.
async function stageRunFiles(meta, files, root) {
  await clearRunCache();
  const cache = await caches.open(RUN_CACHE);
  const base = new URL(`run/${meta.id}/`, location.href);
  const shim = `<script src="${new URL('apk-shim.js', location.href).href}"></script>`;
  for (let i = 0; i < files.length; i++) {
    if (locked) return null;
    showProgress('Preparando la app…', meta.name, i / files.length);
    const path = files[i].name.slice(root.length);
    const ext = extOf(path);
    let blob = await files[i].blob();
    let type = WEB_MIME[ext] || 'application/octet-stream';
    if (ext === 'html' || ext === 'htm') {
      const html = await blob.text();
      const head = /<head[^>]*>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
      const at = head ? head.index + head[0].length : 0;
      type = 'text/html; charset=utf-8';
      blob = new Blob([html.slice(0, at), shim, html.slice(at)]);
    }
    await cache.put(runUrl(new URL(path.replace(/[?#%]/g, encodeURIComponent), base).href), new Response(blob, { headers: { 'Content-Type': type } }));
  }
  return base;
}

// Copia la web descifrada a una caché temporal (se borra al cerrar) y la abre en el visor.
async function openWebApp(meta, file, info = null) {
  if (busy) return;
  if (!self.caches || !navigator.serviceWorker?.controller) {
    ask({ title: 'No se puede abrir', message: 'Para abrir apps web, abre el Baúl desde su icono de la pantalla de inicio y vuelve a intentarlo.', cancel: null });
    return;
  }
  busy = true;
  try {
    info ??= await inspectApp(meta, file);
    if (!info.page) throw new Error(info.engine !== undefined || ANDROID_EXTS.has(extOf(meta.name))
      ? nativeApkReason(info.engine) : 'No hay ningún index.html dentro del .zip.');
    const base = await stageRunFiles(meta, info.files, info.root);
    hideProgress();
    if (!base || locked) await clearRunCache();
    else openPlayer(meta, new URL(info.page, base).href, null, { web: true });
  } catch (err) {
    hideProgress();
    await clearRunCache();
    ask({ title: 'No se puede abrir', message: err.message || String(err), cancel: null });
  } finally {
    busy = false;
    hideProgress();
  }
}

// Partidas de las apps web: van en el almacenamiento de la app con el prefijo de su archivo (ver apk-shim.js).
async function clearWebAppData(ids) {
  const mine = name => name?.startsWith('apk:') && (!ids || ids.some(id => name.startsWith(`apk:${id}:`)));
  // Partidas de Flash: Ruffle las guarda como «servidor/ruta del .swf/nombre», y esa ruta lleva el identificador.
  const flash = k => k?.startsWith(`${location.hostname}/`) && (!ids || ids.some(id => k.includes(`/${id}.swf/`) || k.includes(`/run/${id}/`)));
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (mine(k) || flash(k)) localStorage.removeItem(k);
    }
  } catch { /* sin almacenamiento */ }
  try {
    for (const d of (await indexedDB.databases?.()) || []) if (mine(d.name)) indexedDB.deleteDatabase(d.name);
  } catch { /* nada que borrar */ }
}

// Formas reales de usar en el iPhone programas de Windows y apps de Android (fuera del Baúl).
const WAYS = {
  windows: {
    title: 'Programas de Windows en el iPhone',
    note: 'Los .exe de MS-DOS se abren aquí mismo. Para los de Windows, estas son las formas que existen:',
    options: [
      { label: 'Madeira: juegos de Windows en el iPhone', sub: 'Ejecuta juegos .exe de verdad, sin jailbreak (iOS 26 o posterior). Se instala fuera de la App Store con SideStore y hay que activar JIT. Experimental. Copia la carpeta del juego en Madeira con «Abrir en otra app» → «Guardar en Archivos»', href: 'https://github.com/willfaust/Madeira' },
      { label: 'Desde tu PC con Windows', sub: 'Pásale el archivo con «Abrir en otra app» y maneja el PC desde el iPhone con Windows App (Microsoft, gratis)', href: 'https://apps.apple.com/app/id1295203466' },
      { label: 'Juegos de tu PC, en el iPhone', sub: 'Steam Link (gratis): juega por wifi a lo que tengas en el PC', href: 'https://apps.apple.com/app/id1246969117' },
      { label: 'Cualquier juego de tu PC', sub: 'Moonlight (gratis), con Sunshine instalado en el PC. Mejor con un mando', href: 'https://apps.apple.com/app/id1000551566' },
      { label: 'Juegos de PC en la nube, sin PC', sub: 'GeForce NOW en Safari: juegos de Steam o Epic que tengas comprados', href: 'https://play.geforcenow.com' },
      { label: 'Windows antiguo dentro del iPhone', sub: 'UTM SE (gratis): emula un PC con Windows 95, 98 o XP. Lento, y necesitas tu propia copia de Windows', href: 'https://apps.apple.com/app/id1564628856' },
    ],
  },
  android: {
    title: 'Apps de Android en el iPhone',
    note: 'Antes de nada, mira si la app o el juego está en la App Store. Si no, estas son las formas que existen:',
    options: [
      { label: 'Husk: apps y juegos Android en el iPhone', sub: 'Ejecuta el .apk de verdad, sin jailbreak (iOS 16 o posterior). Se instala fuera de la App Store con SideStore o AltStore y hay que activar JIT. Va mejor con juegos de 64 bits. Pásale el .apk con «Abrir en otra app» → «Guardar en Archivos»', href: 'https://github.com/Leviidev/Husk' },
      { label: 'Juegos Android en la nube', sub: 'now.gg (BlueStacks X) en Safari: sin instalar nada, pero solo los juegos de su catálogo', href: 'https://now.gg' },
      { label: 'Android en la nube', sub: 'Appetize.io: subes el .apk y lo usas en Safari. Gratis con minutos limitados (el archivo sale de tu iPhone)', href: 'https://appetize.io' },
      { label: 'Desde tu PC', sub: 'Instala el .apk en un emulador como BlueStacks y maneja el PC desde el iPhone con Escritorio remoto de Chrome', href: 'https://remotedesktop.google.com/access' },
    ],
  },
};
function waysButton(kind) {
  const b = el('button', 'open', 'Otras formas (fuera del Baúl)');
  b.onclick = () => menu(WAYS[kind].title, WAYS[kind].options, WAYS[kind].note);
  return b;
}

// Archivos que usan los emuladores en este dispositivo, para descargarlos y poder jugar sin internet.
const EMU_DATA = 'vendor/emulatorjs/data/';
const EMU_CORES = { fceumm: false, snes9x: false, gambatte: false, mgba: false, genesis_plus_gx: false, pcsx_rearmed: true, melonds: true };
function emulatorFiles() {
  const webgl2 = !!document.createElement('canvas').getContext('webgl2');
  // Igual que EmulatorJS: en Safari de iPhone usa parallel_n64 para la N64.
  const cores = { ...EMU_CORES, ...(isIOS ? { parallel_n64: false } : { mupen64plus_next: true }) };
  const files = ['emulator.html', `${EMU_DATA}loader.js`, `${EMU_DATA}emulator.min.js`, `${EMU_DATA}emulator.min.css`,
    `${EMU_DATA}localization/es-ES.json`, `${EMU_DATA}compression/extract7z.js`, `${EMU_DATA}compression/extractzip.js`,
    `${EMU_DATA}compression/libunrar.js`, `${EMU_DATA}compression/libunrar.wasm`];
  for (const [core, usesWebgl2] of Object.entries(cores)) {
    files.push(`${EMU_DATA}cores/reports/${core}.json`, `${EMU_DATA}cores/${core}${usesWebgl2 && webgl2 ? '' : '-legacy'}-wasm.data`);
  }
  files.push('dos.html', 'vendor/jsdos/js-dos.js', 'vendor/jsdos/js-dos.css',
    ...['emulators.js', 'wdosbox.js', 'wdosbox.wasm', 'wlibzip.js', 'wlibzip.wasm'].map(f => `vendor/jsdos/emulators/${f}`));
  return files;
}

$('#vClose').addEventListener('click', closeViewer);
$('#vShare').addEventListener('click', () => { if (view.file) shareFiles([view.file]); });
$('#vQuality').addEventListener('click', async () => {
  const meta = view.list[view.index];
  if (!meta || meta.kind !== 'video') return;
  if (meta.status === 'raw') { toast('Este vídeo ya se está procesando'); return; }
  const value = await chooseVideoQuality([{ size: meta.outSize, duration: meta.duration, w: meta.w, h: meta.h }], { recompress: true });
  if (!value || locked) return;
  Object.assign(meta, { vq: value, status: 'raw', thumbReady: true });
  await saveMeta(meta);
  toast('Comprimiendo el vídeo… puedes seguir usando la app');
  renderSoon();
  runOptimizer();
});
$('#vMove').addEventListener('click', () => {
  const meta = view.list[view.index];
  if (meta) moveEntries([meta.id], []);
});

$('#vRename').addEventListener('click', async () => {
  const meta = view.list[view.index];
  if (!meta) return;
  let name = await ask({ title: 'Renombrar', input: meta.name, ok: 'Guardar' });
  if (!name || name === meta.name) return;
  const ext = extOf(meta.name);
  if (ext && !extOf(name)) name += `.${ext}`;
  meta.name = name;
  await saveMeta(meta);
  $('#vName').textContent = name;
  if (view.file) view.file = new File([view.file], name, { type: view.file.type, lastModified: view.file.lastModified });
  render();
});

$('#vDelete').addEventListener('click', async () => {
  const meta = view.list[view.index];
  if (!meta || !(await deleteEntries([meta.id], []))) return;
  view.list.splice(view.index, 1);
  if (!view.list.length) closeViewer();
  else showItem(Math.min(view.index, view.list.length - 1));
});

$('#vInfo').addEventListener('click', () => {
  const m = view.list[view.index];
  if (!m) return;
  const rows = [
    ['Carpeta', ['Baúl', ...folderPath(folderOf(m))].join(' › ')],
    ['Tipo', m.type],
    ['Original', fmtBytes(m.size)],
    ['En el baúl', fmtBytes(m.storedSize)],
    ['Ahorro', m.size > m.storedSize ? `${fmtBytes(m.size - m.storedSize)} (${minusPct(m.size - m.storedSize, m.size)})` : '—'],
  ];
  if (m.w && m.h) rows.push(['Medidas', `${m.w} × ${m.h} px`]);
  if (m.duration) rows.push(['Duración', fmtDur(m.duration)]);
  if (m.kind === 'video') {
    const p = videoPreset(m.vcompressed);
    rows.push(['Calidad', videoPreset(m.vq) ? 'Comprimiendo…' : p ? `${p.label} · ${p.res}` : 'Original']);
  }
  rows.push(['Compresión', m.status === 'raw' ? 'Comprimiendo…' : m.vcompressed ? 'Vídeo recomprimido' : m.reencoded ? 'Foto optimizada' : m.enc === 'gzip' ? 'Sin pérdidas' : 'Guardado tal cual']);
  rows.push(['Cifrado', 'AES-256']);
  rows.push(['Añadido', fmtDate(m.added)]);
  const table = el('table');
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  ask({ title: m.name, extra: table, cancel: null, ok: 'Cerrar' });
});

/* ---- Gestos: deslizar, pellizcar para ampliar, doble toque ---- */

function applyZoom(animate) {
  if (!zoom.el) return;
  zoom.el.style.transition = animate ? 'transform .22s ease-out' : 'none';
  zoom.el.style.transform = zoom.s === 1 && !zoom.tx && !zoom.ty ? '' : `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`;
}
function resetZoom(animate) {
  zoom.s = 1;
  zoom.tx = zoom.ty = 0;
  applyZoom(animate);
}
function clampZoom() {
  if (!zoom.el) return;
  if (zoom.s <= 1.02) { resetZoom(true); return; }
  const mx = Math.max(0, (zoom.el.offsetWidth * zoom.s - stage.clientWidth) / 2);
  const my = Math.max(0, (zoom.el.offsetHeight * zoom.s - stage.clientHeight) / 2);
  zoom.tx = Math.min(mx, Math.max(-mx, zoom.tx));
  zoom.ty = Math.min(my, Math.max(-my, zoom.ty));
  applyZoom(true);
}
function stageCenter() {
  const r = stage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function zoomAt(x, y) {
  if (!zoom.el) return;
  if (zoom.s > 1) { resetZoom(true); return; }
  const o = stageCenter();
  zoom.s = 2.5;
  zoom.tx = (x - o.x) * (1 - zoom.s);
  zoom.ty = (y - o.y) * (1 - zoom.s);
  clampZoom();
}

const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
let gesture = null;
let lastTap = 0;
let tapTimer;

stage.addEventListener('touchstart', e => {
  const t = e.touches;
  if (t.length === 2 && zoom.el) {
    gesture = { type: 'pinch', d0: dist(t[0], t[1]), m0: mid(t[0], t[1]), s0: zoom.s, tx0: zoom.tx, ty0: zoom.ty };
  } else if (t.length === 1 && !gesture) {
    gesture = {
      type: 'pan', x0: t[0].clientX, y0: t[0].clientY, tx0: zoom.tx, ty0: zoom.ty, moved: false,
      onMedia: !!e.target.closest('video, audio, .textview, button'),
    };
  }
}, { passive: true });

stage.addEventListener('touchmove', e => {
  if (!gesture) return;
  const t = e.touches;
  if (gesture.type === 'pinch' && t.length === 2) {
    e.preventDefault();
    const g = gesture;
    const s = Math.min(6, Math.max(0.8, g.s0 * dist(t[0], t[1]) / g.d0));
    const m = mid(t[0], t[1]);
    const o = stageCenter();
    zoom.s = s;
    zoom.tx = m.x - o.x - s * (g.m0.x - o.x - g.tx0) / g.s0;
    zoom.ty = m.y - o.y - s * (g.m0.y - o.y - g.ty0) / g.s0;
    applyZoom(false);
  } else if (gesture.type === 'pan' && t.length === 1) {
    const dx = t[0].clientX - gesture.x0;
    const dy = t[0].clientY - gesture.y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) gesture.moved = true;
    if (zoom.el && zoom.s > 1) {
      e.preventDefault();
      zoom.tx = gesture.tx0 + dx;
      zoom.ty = gesture.ty0 + dy;
      applyZoom(false);
    } else if (zoom.el && gesture.moved) {
      e.preventDefault();
      zoom.el.style.transition = 'none';
      zoom.el.style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx}px)` : `translateY(${Math.max(0, dy)}px)`;
    }
  }
}, { passive: false });

stage.addEventListener('touchend', e => {
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') {
    if (!e.touches.length) { gesture = null; clampZoom(); }
    return;
  }
  gesture = null;
  const ct = e.changedTouches[0];
  const dx = ct.clientX - g.x0;
  const dy = ct.clientY - g.y0;
  if (g.moved) {
    if (zoom.el && zoom.s > 1) { clampZoom(); return; }
    if (!g.onMedia) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        const i = view.index + (dx < 0 ? 1 : -1);
        if (i >= 0 && i < view.list.length) { showItem(i); return; }
      } else if (dy > 110 && dy > Math.abs(dx) * 1.3) {
        closeViewer();
        return;
      }
    }
    resetZoom(true);
    return;
  }
  if (zoom.el) {
    const now = Date.now();
    clearTimeout(tapTimer);
    if (now - lastTap < 300) {
      lastTap = 0;
      zoomAt(ct.clientX, ct.clientY);
    } else {
      lastTap = now;
      tapTimer = setTimeout(() => viewer.classList.toggle('bare'), 300);
    }
  }
});

stage.addEventListener('dblclick', e => zoomAt(e.clientX, e.clientY));
// Evita que Safari amplíe toda la página al pellizcar.
document.addEventListener('gesturestart', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (viewer.hidden || !emu.hidden || !$('#lock').hidden || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

/* ================= Ajustes ================= */

const settings = $('#settings');

function renderQuality() {
  for (const b of document.querySelectorAll('#qualityGroup .row')) {
    b.setAttribute('aria-checked', String(b.dataset.q === quality));
  }
}
function renderVideoPref() {
  for (const b of document.querySelectorAll('#videoGroup .row')) {
    b.setAttribute('aria-checked', String(b.dataset.vq === videoPref));
  }
}

function renderAutoLock() {
  const current = prefs.get('baul.autolock', '60');
  for (const b of document.querySelectorAll('#autoLockGroup .row')) {
    b.setAttribute('aria-checked', String(b.dataset.lock === current));
  }
}

async function renderStorage() {
  const size = state.items.reduce((s, m) => s + m.size, 0);
  const stored = state.items.reduce((s, m) => s + m.storedSize, 0);
  $('#stUsed').textContent = fmtBytes(stored);
  $('#stSaved').textContent = size > stored ? `${fmtBytes(size - stored)} (${minusPct(size - stored, size)})` : '—';
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) || {};
    $('#stFree').textContent = quota ? fmtBytes(Math.max(0, quota - usage)) : '—';
  } catch { $('#stFree').textContent = '—'; }
  try {
    const persisted = await navigator.storage?.persisted?.();
    $('#stPersist').textContent = persisted ? 'Sí ✓' : isStandalone ? 'Pendiente' : 'Instala la app';
  } catch { $('#stPersist').textContent = '—'; }
}

$('#settingsBtn').addEventListener('click', () => {
  renderQuality();
  renderVideoPref();
  renderAutoLock();
  renderStorage();
  renderOfflinePacks();
  videoEncoderCodec().then(codec => {
    $('#videoSupport').textContent = codec
      ? `Este dispositivo comprime vídeo en ${CODEC_NAMES[codec] || codec} ✓`
      : 'Este dispositivo no permite comprimir vídeos desde la app: se guardan en calidad original.';
  });
  $('#version').textContent = `Baúl ${APP_VERSION} · ${canGzip ? 'compresión activa' : 'tu iOS no permite comprimir: actualiza a iOS 16.4 o superior'}`;
  renderUpdate();
  settings.showModal();
});
$('#settingsClose').addEventListener('click', () => settings.close());
settings.addEventListener('click', e => {
  const r = settings.getBoundingClientRect();
  if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) settings.close();
});

for (const b of document.querySelectorAll('#qualityGroup .row')) {
  b.addEventListener('click', () => {
    quality = b.dataset.q;
    prefs.set('baul.quality', quality);
    renderQuality();
  });
}
// Motores que se pueden descargar para jugar sin internet (también se guardan solos la primera vez que se usan).
const GODOT_RUNTIMES = ['3.6.3', '4.3', '4.4.1', '4.7.2'];
const OFFLINE_PACKS = {
  gamesOffline: { what: 'emuladores', size: '≈ 12 MB', files: () => emulatorFiles() },
  renpyOffline: {
    what: "el motor de Ren'Py", size: '≈ 25 MB',
    files: () => [
      'renpy.html', ...['renpy-pre.js', 'renpy.js', 'renpy.wasm', 'renpy.data', 'renpy-engine.zip'].map(f => `vendor/renpy-${RENPY_RUNTIMES[8]}/${f}`),
      ...['index.html', 'index.js', 'index.wasm', 'pyapp-data.js', 'pyapp.data', 'pythonhome-data.js', 'pythonhome.data', 'renpy-engine.zip'].map(f => `vendor/renpy-${RENPY_RUNTIMES[7]}/${f}`),
    ],
  },
  flashOffline: {
    what: 'Flash y LÖVE', size: '≈ 12 MB',
    files: () => ['flash.html', 'love.html', 'vendor/love-11.4/love.js', 'vendor/love-11.4/love.wasm',
      ...['172de42e6619eac8f371.wasm', '878d548199cddef07035.wasm', 'core.ruffle.16d61072ac7fdc4d5013.js', 'core.ruffle.994eeef0a471a88cd0e3.js', 'ruffle.js'].map(f => `vendor/ruffle-0.7.1/${f}`)],
  },
  godotOffline: {
    what: 'el motor de Godot', size: '≈ 40 MB',
    files: () => ['godot.html', ...GODOT_RUNTIMES.flatMap(v => ['godot.js', 'godot.wasm', 'godot.audio.worklet.js', ...(v.startsWith('4') ? ['godot.audio.position.worklet.js'] : [])].map(f => `vendor/godot-${v}/${f}`))],
  },
};
// «Listo» si todos sus archivos ya están en el iPhone (se conservan de una versión de la app a otra).
async function renderOfflinePacks() {
  for (const [id, pack] of Object.entries(OFFLINE_PACKS)) {
    const files = pack.files();
    const have = await Promise.all(files.map(f => caches.match(f, { ignoreSearch: true }))).catch(() => []);
    $(`#${id} .val`).textContent = have.length === files.length && have.every(Boolean) ? 'Listo ✓' : pack.size;
  }
}
for (const [id, pack] of Object.entries(OFFLINE_PACKS)) {
  $(`#${id}`).addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const files = pack.files();
    try {
      for (let i = 0; i < files.length; i++) {
        showProgress(`Descargando ${pack.what}…`, `${i + 1} de ${files.length}`, i / files.length);
        const res = await fetch(files[i]);
        if (!res.ok) throw new Error(`No se pudo descargar ${files[i].split('/').pop()}`);
        await res.arrayBuffer();
      }
      toast('Listo: ya puedes jugar sin internet');
    } catch (err) {
      ask({ title: 'No se pudo descargar', message: `${err.message || err}\n\nComprueba la conexión e inténtalo otra vez.`, cancel: null });
    } finally {
      busy = false;
      hideProgress();
      renderOfflinePacks();
    }
  });
}

for (const b of document.querySelectorAll('#videoGroup .row')) {
  b.addEventListener('click', () => {
    videoPref = b.dataset.vq;
    prefs.set('baul.videoq', videoPref);
    renderVideoPref();
  });
}
for (const b of document.querySelectorAll('#autoLockGroup .row')) {
  b.addEventListener('click', () => {
    prefs.set('baul.autolock', b.dataset.lock);
    renderAutoLock();
  });
}

/* ================= Copias de seguridad ================= */

const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const BACKUP_README = `Copia de seguridad cifrada del Baúl.

Para recuperarla: abre el Baúl → Ajustes → «Restaurar desde una copia» y elige este .zip.
Te pedirá el código que tenía el Baúl cuando hiciste la copia.
Sin ese código los archivos no se pueden abrir.
`;

// La copia guarda los archivos tal como están en el baúl (comprimidos y cifrados), las carpetas y la llave
// protegida con el código: ocupa poco y nadie puede abrirla sin el código.
$('#backupBtn').addEventListener('click', async () => {
  if (!state.items.length && !state.folders.length) { toast('El baúl está vacío'); return; }
  settings.close();
  busy = true;
  try {
    const cfg = await dbGetConfig();
    const entries = [{ name: 'LEEME.txt', blob: new Blob([BACKUP_README]), date: new Date() }];
    const files = [];
    for (let i = 0; i < state.items.length; i++) {
      const m = state.items[i];
      showProgress('Preparando copia…', m.name, (i / state.items.length) * 0.2);
      const data = await dbBlob(m.id);
      if (!data) continue;
      const thumb = await dbThumb(m.id);
      const item = { ...m, data: `datos/${i}` };
      entries.push({ name: item.data, blob: data, date: new Date(m.added) });
      if (thumb) {
        item.thumb = `datos/${i}.min`;
        entries.push({ name: item.thumb, blob: thumb, date: new Date(m.added) });
      }
      files.push(item);
    }
    const header = {
      app: 'baul', version: 2, created: Date.now(),
      salt: toB64(cfg.salt), iterations: cfg.iterations, wrapped: toB64(cfg.wrapped),
    };
    entries.push({ name: 'baul.json', blob: new Blob([JSON.stringify(header)]), date: new Date() });
    entries.push({ name: 'indice.bin', blob: new Blob([await sealJSON({ files, folders: state.folders }, masterKey)]), date: new Date() });
    const zip = await buildZip(entries, (i, n) => showProgress('Creando copia…', `${Math.round((i / n) * 100)} %`, 0.2 + (i / n) * 0.8));
    hideProgress();
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = new File([zip], `Baul-copia-${stamp}.zip`, { type: 'application/zip' });
    await offerShare([file], 'Copia lista',
      `${fmtBytes(file.size)} · va cifrada con tu código. Elige «Guardar en Archivos» (por ejemplo en iCloud Drive).`);
  } catch (err) {
    hideProgress();
    ask({ title: 'No se pudo crear la copia', message: String(err.message || err), cancel: null });
  } finally {
    busy = false;
  }
});

async function restoreEncrypted(header, entriesByName, report) {
  const cfg = await dbGetConfig();
  const backupCfg = { salt: fromB64(header.salt), iterations: header.iterations, wrapped: fromB64(header.wrapped) };
  // Copia de este mismo baúl y con el código actual: no hace falta pedirlo.
  let key = sameBytes(backupCfg.wrapped, cfg.wrapped) ? masterKey : null;
  let error = '';
  while (!key) {
    hideProgress();
    const pin = await pinPad.ask({
      title: 'Código de la copia', sub: 'Escribe el código que tenía el Baúl cuando hiciste esta copia.', error, cancel: true,
    });
    if (pin === null) { pinPad.close(); report.cancelled = true; return; }
    pinPad.wait('Comprobando…');
    const raw = await unwrapMaster(backupCfg, pin);
    if (raw) { key = await importMaster(raw); raw.fill(0); }
    error = 'Código incorrecto';
  }
  pinPad.close();
  const indexEntry = entriesByName.get('indice.bin');
  if (!indexEntry) throw new Error('La copia está incompleta.');
  const index = await openJSON(new Uint8Array(await (await indexEntry.blob()).arrayBuffer()), key);
  const files = Array.isArray(index) ? index : index.files || [];
  const folders = Array.isArray(index) ? [] : index.folders || [];
  const knownFolders = new Set(state.folders.map(f => f.id));
  for (const f of folders) {
    if (knownFolders.has(f.id)) continue;
    await saveFolder(f);
    state.folders.push(f);
  }
  const existing = new Set(state.items.map(m => `${m.name}|${m.added}`));
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    showProgress(`Restaurando ${i + 1} de ${files.length}`, item.name, i / files.length);
    await nextFrame();
    if (existing.has(`${item.name}|${item.added}`)) { report.skipped++; continue; }
    try {
      let data = await entriesByName.get(item.data).blob();
      let thumb = item.thumb && entriesByName.has(item.thumb) ? await entriesByName.get(item.thumb).blob() : null;
      if (key === masterKey) {
        // Copia propia de los datos: el .zip elegido es un archivo temporal de iOS.
        data = new Blob([await data.arrayBuffer()]);
        if (thumb) thumb = new Blob([await thumb.arrayBuffer()]);
      } else {
        data = await encryptBlob(await decryptBlob(data, key), masterKey);
        if (thumb) thumb = await encryptBlob(await decryptBlob(thumb, key), masterKey);
      }
      const meta = { ...item, id: uid(), storedSize: data.size };
      delete meta.data;
      delete meta.thumb;
      await dbPut(await sealMeta(meta), data, thumb);
      report.added++;
    } catch (err) {
      console.error(err);
      report.failed.push(item.name);
    }
  }
}

// .zip normales (o copias de la versión 1.0, sin cifrar): se añade cada archivo a la carpeta actual.
async function restorePlain(entries, manifest, report) {
  const files = entries.filter(x => !x.name.endsWith('/') && x.name !== 'baul.json'
    && !x.name.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(x.name));
  const existing = new Set(state.items.map(m => `${m.name}|${m.added}`));
  for (let i = 0; i < files.length; i++) {
    const entry = files[i];
    const info = manifest?.files?.[entry.name];
    const name = info?.name || entry.name.split('/').pop();
    showProgress(`Restaurando ${i + 1} de ${files.length}`, name, i / files.length);
    await nextFrame();
    if (info && existing.has(`${name}|${info.added}`)) { report.skipped++; continue; }
    if (entry.encrypted) { report.failed.push(`${name} (protegido con contraseña)`); continue; }
    try {
      const blob = await entry.blob();
      const file = new File([blob], name, { type: info?.type || '' });
      // Lo que viene de una copia del Baúl ya está optimizado: no volver a recomprimir fotos.
      await ingestOne(file, { keepOriginal: !!manifest, added: info?.added, originalSize: info?.size, folder: state.folder });
      report.added++;
    } catch (err) {
      console.error(err);
      report.failed.push(name);
    }
  }
}

$('#restoreBtn').addEventListener('click', () => { settings.close(); openPicker($('#restoreInput')); });
$('#restoreInput').addEventListener('change', async e => {
  pickingSince = 0;
  const zipFile = e.target.files[0];
  e.target.value = '';
  if (!zipFile || locked) return;
  busy = true;
  requestPersist();
  const report = { added: 0, skipped: 0, failed: [], cancelled: false };
  try {
    const entries = await readZip(zipFile);
    const entriesByName = new Map(entries.map(x => [x.name, x]));
    let header = null;
    if (entriesByName.has('baul.json')) {
      try { header = JSON.parse(await (await entriesByName.get('baul.json').blob()).text()); } catch { header = null; }
    }
    if (header?.version === 2) await restoreEncrypted(header, entriesByName, report);
    else await restorePlain(entries, header, report);
  } catch (err) {
    report.failed.push(String(err.message || err));
  } finally {
    busy = false;
    hideProgress();
  }
  await refresh();
  runOptimizer();
  if (report.cancelled) return;
  const parts = [`${report.added} ${report.added === 1 ? 'archivo restaurado' : 'archivos restaurados'}`];
  if (report.skipped) parts.push(`${report.skipped} ya estaban en el baúl`);
  await ask({
    title: 'Restauración terminada',
    message: parts.join('\n') + (report.failed.length ? `\n\nNo se pudieron restaurar:\n${report.failed.join('\n')}` : ''),
    cancel: null,
  });
});

$('#wipeBtn').addEventListener('click', async () => {
  const yes = await ask({
    title: '¿Vaciar el baúl?',
    message: `Se borrarán ${plural(state.items.length, 'archivo', 'archivos')} y ${plural(state.folders.length, 'carpeta', 'carpetas')} de este iPhone. No se puede deshacer.`,
    ok: 'Vaciar', danger: true,
  });
  if (!yes) return;
  await dbClear();
  await clearGameSaves();
  settings.close();
  state.folder = null;
  await refresh();
  toast('Baúl vacío');
});

/* ================= Código de acceso ================= */

const lockEl = $('#lock');
const keypad = $('#keypad');

const pinPad = {
  value: '',
  resolve: null,
  // Pide un código de 6 cifras. Devuelve null si se cancela.
  ask({ title, sub = '', error = '', cancel = false, forgot = false }) {
    lockEl.hidden = false;
    lockEl.classList.remove('checking');
    this.value = '';
    this.renderDots();
    $('#lockTitle').textContent = title;
    this.message(error || sub, !!error);
    $('#lockCancel').style.visibility = cancel ? 'visible' : 'hidden';
    $('#lockForgot').hidden = !forgot;
    keypad.classList.remove('wait');
    if (error) {
      for (const node of [$('#dots'), lockEl]) {
        node.classList.remove(node === lockEl ? 'wrong' : 'shake');
        void node.offsetWidth;
        node.classList.add(node === lockEl ? 'wrong' : 'shake');
      }
      navigator.vibrate?.(180);
    }
    return new Promise(resolve => { this.resolve = resolve; });
  },
  message(text, isError = false) {
    const p = $('#lockSub');
    p.textContent = text;
    p.classList.toggle('err', isError);
  },
  wait(text) {
    keypad.classList.add('wait');
    if (text != null) this.message(text);
  },
  ready(text = '') {
    keypad.classList.remove('wait');
    this.message(text);
  },
  close() {
    this.resolve = null;
    lockEl.hidden = true;
    lockEl.classList.remove('checking', 'wrong', 'closing');
  },
  cancel() {
    const r = this.resolve;
    this.resolve = null;
    r?.(null);
  },
  renderDots() {
    [...$('#dots').children].forEach((d, i) => d.classList.toggle('on', i < this.value.length));
  },
  press(k) {
    if (!this.resolve || keypad.classList.contains('wait')) return;
    if (k === 'del') this.value = this.value.slice(0, -1);
    else if (this.value.length < PIN_LENGTH) this.value += k;
    this.renderDots();
    if (this.value.length === PIN_LENGTH) {
      const v = this.value;
      const r = this.resolve;
      this.resolve = null;
      setTimeout(() => r(v), 140);
    }
  },
};

keypad.addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if (b) pinPad.press(b.dataset.k);
});
$('#lockCancel').addEventListener('click', () => pinPad.cancel());
document.addEventListener('keydown', e => {
  if (lockEl.hidden || document.querySelector('dialog[open]')) return;
  if (/^\d$/.test(e.key)) pinPad.press(e.key);
  else if (e.key === 'Backspace') pinPad.press('del');
  else if (e.key === 'Escape' && $('#lockCancel').style.visibility === 'visible') pinPad.cancel();
});

function isWeakPin(pin) {
  return /^(\d)\1+$/.test(pin) || '01234567890'.includes(pin) || '09876543210'.includes(pin);
}

// Tras 5 fallos seguidos hay que esperar, cada vez más (máx. 15 min).
const MAX_TRIES = 5;
const lockoutLeft = () => Math.max(0, Number(prefs.get('baul.lockUntil', '0')) - Date.now());
function registerFailure() {
  const fails = Number(prefs.get('baul.fails', '0')) + 1;
  prefs.set('baul.fails', String(fails));
  if (fails >= MAX_TRIES) {
    prefs.set('baul.lockUntil', String(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (fails - MAX_TRIES))));
  }
  return fails;
}
function resetFailures() {
  prefs.set('baul.fails', '0');
  prefs.set('baul.lockUntil', '0');
}

async function setupFlow() {
  $('#lockHint').hidden = isStandalone;
  try {
    let error = '';
    for (;;) {
      const a = await pinPad.ask({
        title: 'Crea tu código', sub: 'Elige 6 números. Te lo pediré cada vez que abras el Baúl.', error,
      });
      if (isWeakPin(a)) { error = 'Ese código es muy fácil de adivinar. Elige otro.'; continue; }
      const b = await pinPad.ask({ title: 'Repite el código', sub: 'Apúntalo en un sitio seguro: si lo olvidas, no se pueden recuperar tus archivos.' });
      if (a === b) {
        pinPad.wait('Preparando tu baúl…');
        lockEl.classList.add('checking');
        await createVault(a);
        resetFailures();
        return;
      }
      error = 'Los códigos no coinciden. Vuelve a empezar.';
    }
  } finally {
    $('#lockHint').hidden = true;
  }
}

// Devuelve false si se borró el baúl con «¿Olvidaste el código?».
async function unlockFlow() {
  let error = '';
  for (;;) {
    const pending = pinPad.ask({ title: 'Introduce tu código', error, forgot: true });
    while (lockoutLeft() > 0) {
      pinPad.wait(`Demasiados intentos. Espera ${fmtDur(lockoutLeft() / 1000)}`);
      await sleep(1000);
    }
    if (keypad.classList.contains('wait')) pinPad.ready();
    const pin = await pending;
    if (pin === null) return false;
    pinPad.wait('');
    lockEl.classList.add('checking');
    if (await unlockVault(pin)) { resetFailures(); return true; }
    const fails = registerFailure();
    error = fails < MAX_TRIES ? `Código incorrecto · ${plural(MAX_TRIES - fails, 'intento', 'intentos')} más antes de esperar` : 'Código incorrecto';
  }
}

// Animación: la llave gira, el candado se abre y se entra al baúl.
async function playUnlock(loading) {
  lockEl.classList.remove('checking', 'closing', 'wrong');
  lockEl.classList.add('unlocking');
  await Promise.all([sleep(REDUCED_MOTION ? 0 : 820), loading.catch(() => {})]);
  lockEl.classList.add('leaving');
  document.body.classList.remove('is-locked');
  await sleep(REDUCED_MOTION ? 0 : 560);
  pinPad.close();
  lockEl.classList.remove('unlocking', 'leaving');
}

// Muestra la pantalla del código hasta que el baúl queda abierto.
async function gate() {
  for (;;) {
    if (!(await dbGetConfig())) { await setupFlow(); break; }
    if (await unlockFlow()) break;
  }
  locked = false;
  const loading = (async () => { await encryptLegacy(); await refresh(); })();
  await playUnlock(loading);
  await loading;
  runOptimizer();
  askPendingVideoQuality();
}

$('#lockForgot').addEventListener('click', async () => {
  const yes = await ask({
    title: '¿Olvidaste el código?',
    message: 'Tus archivos están cifrados con él: sin el código no hay forma de abrirlos.\n\nPuedes borrar el baúl y empezar de cero con un código nuevo. Si tienes una copia de seguridad, podrás restaurarla con el código que tenías al hacerla.',
    ok: 'Borrar el baúl', danger: true,
  });
  if (!yes) return;
  const sure = await ask({
    title: '¿Seguro?', message: 'Se borrarán todos los archivos y carpetas del baúl. No se puede deshacer.', ok: 'Sí, borrar todo', danger: true,
  });
  if (!sure) return;
  await dbWipeAll();
  await clearGameSaves();
  resetFailures();
  state.folder = null;
  pinPad.cancel();
});

let updateReady = false;
function renderUpdate() {
  $('#updateBtn .grow').textContent = updateReady ? 'Poner la versión nueva' : 'Buscar actualización';
  $('#updateVal').textContent = updateReady ? 'Lista ✓' : '';
}
// Busca una versión nueva de la app (iOS no recarga las apps que vuelven del segundo plano: hay que pedirlo).
let lastUpdateCheck = Date.now();
async function checkForUpdate() {
  lastUpdateCheck = Date.now();
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update();
  return reg?.installing || reg?.waiting || null;
}
$('#updateBtn').addEventListener('click', async () => {
  // Para ponerla, el Baúl se bloquea y se recarga: luego se entra con el código, como siempre.
  if (updateReady) { settings.close(); lockNow(); return; }
  $('#updateVal').textContent = 'Buscando…';
  try {
    const next = await checkForUpdate();
    if (!next) { toast(`Ya tienes la última versión (${APP_VERSION})`); return; }
    $('#updateVal').textContent = 'Descargando…';
    await new Promise(resolve => {
      const done = () => { if (next.state === 'activated' || next.state === 'redundant') resolve(); };
      next.addEventListener('statechange', done);
      done();
      setTimeout(resolve, 120_000);
    });
  } catch {
    toast('No se pudo buscar: comprueba la conexión a internet');
  } finally {
    renderUpdate();
  }
});

function lockNow() {
  if (locked) return;
  if (busy) { toast('Espera a que termine'); return; }
  locked = true;
  interruptVideo();
  // Si se está guardando algo, la llave se mantiene hasta que termine (ver ingestList).
  if (!isCopying()) masterKey = null;
  if (updateReady && !isCopying()) { location.reload(); return; }
  document.body.classList.add('is-locked');
  lockEl.classList.remove('unlocking', 'leaving', 'checking', 'wrong', 'closing');
  lockEl.hidden = false;
  pinPad.wait();
  if (!REDUCED_MOTION) {
    void lockEl.offsetWidth;
    lockEl.classList.add('closing');
  }
  closeGame();
  closeViewer();
  askCancel?.();
  menuCancel?.();
  if (settings.open) settings.close();
  state.items = [];
  state.folders = [];
  state.selecting = false;
  state.selected.clear();
  state.selectedFolders.clear();
  seenTiles.clear();
  for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
  thumbUrls.clear();
  grid.replaceChildren();
  updateActivity();
  gate().catch(fatal);
}
$('#lockBtn').addEventListener('click', lockNow);

$('#changePinBtn').addEventListener('click', async () => {
  settings.close();
  const cfg = await dbGetConfig();
  let raw = null;
  let error = '';
  while (!raw) {
    const old = await pinPad.ask({ title: 'Código actual', error, cancel: true });
    if (old === null) { pinPad.close(); return; }
    pinPad.wait('Comprobando…');
    raw = await unwrapMaster(cfg, old);
    error = 'Código incorrecto';
  }
  error = '';
  try {
    for (;;) {
      const a = await pinPad.ask({ title: 'Nuevo código', sub: 'Elige 6 números.', error, cancel: true });
      if (a === null) break;
      if (isWeakPin(a)) { error = 'Ese código es muy fácil de adivinar. Elige otro.'; continue; }
      const b = await pinPad.ask({ title: 'Repite el nuevo código', cancel: true });
      if (b === null) break;
      if (a !== b) { error = 'Los códigos no coinciden. Vuelve a empezar.'; continue; }
      pinPad.wait('Guardando…');
      await dbSetConfig({ ...cfg, ...(await wrapMaster(raw, a)) });
      toast('Código cambiado');
      break;
    }
  } finally {
    raw.fill(0);
    pinPad.close();
  }
});

// Bloqueo automático al salir de la app, y tapa el contenido en el selector de apps de iOS.
let hiddenAt = 0;
const autoLockSeconds = () => Number(prefs.get('baul.autolock', '60'));
document.addEventListener('visibilitychange', () => {
  const open = !locked && lockEl.hidden;
  if (document.hidden) {
    hiddenAt = Date.now();
    // iOS pausa las apps en segundo plano: la compresión de vídeo se corta y se retoma al volver.
    interruptVideo();
    if (!open || isPicking()) return;
    if (autoLockSeconds() === 0 && !busy) lockNow();
    else $('#cover').hidden = false;
  } else {
    $('#cover').hidden = true;
    if (Date.now() - lastUpdateCheck > 10 * 60_000) checkForUpdate().catch(() => {});
    if (open && !isPicking() && Date.now() - hiddenAt >= autoLockSeconds() * 1000) lockNow();
    else if (!locked) runOptimizer();
  }
});

/* ================= Instalación, modo sin conexión y arranque ================= */

if (!isStandalone && prefs.get('baul.hintClosed', '') !== '1') {
  $('#installHint').hidden = false;
  if (!isIOS) {
    $('#hintText').textContent =
      'Desde el menú del navegador elige «Instalar» o «Añadir a pantalla de inicio» para usarlo sin internet.';
  }
}
$('#hintClose').addEventListener('click', () => {
  $('#installHint').hidden = true;
  prefs.set('baul.hintClosed', '1');
});

// La versión, a la vista en la pantalla del código: así se sabe si ya llegó la nueva sin tener que entrar.
$('#lockVersion').textContent = `Baúl ${APP_VERSION}`;

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  // Cada vez que se abre se mira si hay versión nueva, sin fiarse de la caché del navegador.
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update().catch(() => {}))
    .catch(err => console.warn('Sin modo offline:', err));
  // Hay una versión nueva de la app: se carga sola en cuanto no moleste.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (locked && !pinPad.value && !isCopying() && !busy && !masterKey) location.reload();
    else {
      updateReady = true;
      renderUpdate();
      toast('Versión nueva del Baúl lista: se pondrá al bloquearlo');
    }
  });
}
if (isStandalone) requestPersist();
// Si la app se cerró con una app web abierta, su copia temporal se borra ahora.
clearRunCache();

function fatal(err) {
  console.error(err);
  ask({ title: 'No se pudo abrir el baúl', message: String(err.message || err), cancel: null });
}

if (!window.crypto?.subtle) {
  pinPad.wait('Abre el Baúl desde su dirección https:// para poder usar el código.');
} else {
  gate().catch(fatal);
}
