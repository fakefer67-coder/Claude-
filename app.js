'use strict';

const APP_VERSION = '2.0.0';

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
  for (const id of ids) { m.delete(id); b.delete(id); t.delete(id); }
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
const FILE_STYLE = {
  pdf: ['PDF', '#a8383c'], doc: ['DOC', '#2f5aa8'], docx: ['DOC', '#2f5aa8'], pages: ['PAGES', '#b0661c'],
  xls: ['XLS', '#25744a'], xlsx: ['XLS', '#25744a'], numbers: ['NUM', '#25744a'], csv: ['CSV', '#25744a'],
  ppt: ['PPT', '#a8522c'], pptx: ['PPT', '#a8522c'], key: ['KEY', '#2f6aa8'],
  zip: ['ZIP', '#4d475c'], gz: ['GZ', '#4d475c'], rar: ['RAR', '#4d475c'], '7z': ['7Z', '#4d475c'],
  txt: ['TXT', '#4d475c'], md: ['MD', '#4d475c'], json: ['{ }', '#8a6a24'], geojson: ['{ }', '#8a6a24'],
  xml: ['XML', '#6a4a8a'], yaml: ['YML', '#6a4a8a'], yml: ['YML', '#6a4a8a'], epub: ['EPUB', '#7a3f9e'],
};
function fileIcon(meta, big) {
  const icon = el('div', 'ficon' + (big ? ' big' : ''));
  const ext = extOf(meta.name);
  let [label, color] = FILE_STYLE[ext] || (CODE_EXTS.has(ext) ? ['</>', '#3d5a8a'] : [(ext || 'FILE').slice(0, 4).toUpperCase(), '#4f4862']);
  if (meta.kind === 'audio') [label, color] = ['♪', '#6f3f8f'];
  if (meta.kind === 'video') [label, color] = ['▶', '#2c2836'];
  if (meta.kind === 'image') [label, color] = ['IMG', '#2c2836'];
  icon.textContent = label;
  icon.style.backgroundColor = color;
  icon.style.backgroundImage = 'linear-gradient(160deg, rgba(255, 255, 255, .1), rgba(0, 0, 0, .25))';
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
  const c = drawScaled(src, 420, '#24212d');
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

async function ingestOne(file, { keepOriginal = false, added, originalSize, folder = null } = {}) {
  const type = mimeOf(file);
  const meta = {
    id: uid(), name: file.name || 'archivo', type, kind: kindOf(type, file.name),
    size: originalSize || file.size, outSize: file.size, storedSize: 0, enc: 'raw', status: 'raw',
    keep: keepOriginal, folder, added: added || Date.now(),
  };
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
      const next = state.items.find(m => m.status === 'raw');
      if (!next) break;
      try {
        await optimizeOne(next);
      } catch (err) {
        console.error(err);
        if (locked || !masterKey) break;
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
  delete updated.status;
  if (!(await dbReplaceIfExists(await sealMeta(updated, key), sealed, thumb))) return;
  Object.assign(current, updated);
  delete current.status;
}

function updateActivity() {
  const box = $('#activity');
  const copying = isCopying();
  const pending = locked ? 0 : state.items.filter(m => m.status === 'raw').length;
  const show = !locked && (copying || pending > 0);
  box.hidden = !show;
  if (!show) return;
  if (copying) {
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
    entries.push({
      name, encrypted: (flags & 1) === 1, method,
      async blob() {
        const lh = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
        const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = file.slice(start, start + csize);
        if (method === 0) return raw;
        if (method === 8 && canGzip) return streamBlob(raw, new DecompressionStream('deflate-raw'));
        throw new Error('Formato de compresión no compatible');
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
  if (!pending && (m.kind === 'image' || m.kind === 'video')) {
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    tile.append(img);
    thumbObserver.observe(tile);
    if (m.kind === 'video') tile.append(el('span', 'pill dur', m.duration ? fmtDur(m.duration) : '▶'));
  } else {
    const doc = el('div', 'doc');
    doc.append(fileIcon(m), el('span', 'name', m.name));
    tile.append(doc);
  }
  if (pending) {
    tile.classList.add('pending');
    tile.append(el('span', 'busy'));
  } else if (pct(m.size - m.storedSize, m.size) >= 5) {
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
    $('#emptyIcon').hidden = searching || inFolder;
    $('#emptyFolder').hidden = searching || !inFolder;
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
function menu(title, options) {
  return new Promise(resolve => {
    const d = $('#menu');
    const close = value => {
      menuCancel = null;
      d.onclick = d.oncancel = null;
      d.close();
      resolve(value);
    };
    $('#menuTitle').textContent = title;
    const list = $('#menuList');
    list.replaceChildren();
    for (const o of options) {
      const b = el('button', 'row' + (o.danger ? ' danger' : ''));
      b.style.paddingLeft = `${14 + (o.depth || 0) * 20}px`;
      if (o.icon) b.append(svgIcon(o.icon));
      b.append(el('span', 'grow label', o.label));
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
  addFiles(files, { folder });
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
    node = textView(text, meta, file.size > limit);
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
  const open = el('button', 'open', 'Abrir en otra app');
  open.onclick = () => shareFiles([file]);
  box.append(open);
  return box;
}

$('#vClose').addEventListener('click', closeViewer);
$('#vShare').addEventListener('click', () => { if (view.file) shareFiles([view.file]); });
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
  rows.push(['Compresión', m.status === 'raw' ? 'Comprimiendo…' : m.reencoded ? 'Foto optimizada' : m.enc === 'gzip' ? 'Sin pérdidas' : 'Guardado tal cual']);
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
  if (viewer.hidden || !$('#lock').hidden || document.querySelector('dialog[open]')) return;
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
  renderAutoLock();
  renderStorage();
  $('#version').textContent = `Baúl ${APP_VERSION} · ${canGzip ? 'compresión activa' : 'tu iOS no permite comprimir: actualiza a iOS 16.4 o superior'}`;
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
  resetFailures();
  state.folder = null;
  pinPad.cancel();
});

let updateReady = false;

function lockNow() {
  if (locked) return;
  if (busy) { toast('Espera a que termine'); return; }
  locked = true;
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
    if (!open || isPicking()) return;
    if (autoLockSeconds() === 0 && !busy) lockNow();
    else $('#cover').hidden = false;
  } else {
    $('#cover').hidden = true;
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

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Sin modo offline:', err));
  // Hay una versión nueva de la app: se carga sola en cuanto no moleste.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (locked && !pinPad.value && !isCopying() && !busy && !masterKey) location.reload();
    else updateReady = true;
  });
}
if (isStandalone) requestPersist();

function fatal(err) {
  console.error(err);
  ask({ title: 'No se pudo abrir el baúl', message: String(err.message || err), cancel: null });
}

if (!window.crypto?.subtle) {
  pinPad.wait('Abre el Baúl desde su dirección https:// para poder usar el código.');
} else {
  gate().catch(fatal);
}
