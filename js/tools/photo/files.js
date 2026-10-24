// Reading photos on the computer: folder access, EXIF times, thumbnails, QR decoding.
// Nothing here uploads anything — files are read locally in the browser.
import * as store from '../../core/store.js';
import { loadScript } from '../../core/ui.js';
import { largestJpeg, findExifTiff, RAW_RE, HEIC_RE } from './raw.js';

export const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|dng|pef|srw|x3f|3fr|iiq|erf|kdc|mrw)$/i;
export const isJpegLike = (f) => /\.(jpe?g|png|webp)$/i.test(f.name);
export const canPickFolders = () => 'showDirectoryPicker' in window;

/** In-memory map of the current session's files: photoId -> File */
export const sessionFiles = new Map();

async function exifr() { if (!window.exifr) await loadScript('vendor/exifr.umd.js'); return window.exifr; }

/** Walk a directory handle (2 levels deep) and return [{ path, file }]. */
export async function walk(dir, prefix = '', depth = 0, out = []) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'file' && IMAGE_RE.test(name)) out.push({ path: prefix + name, file: await h.getFile() });
    else if (h.kind === 'directory' && depth < 2) await walk(h, `${prefix}${name}/`, depth + 1, out);
  }
  return out;
}

export const saveHandle = (matchId, handle) => store.setLocal(`photo.dir:${matchId}`, handle);
export const getHandle = (matchId) => store.getLocal(`photo.dir:${matchId}`);

export async function ensurePermission(handle, mode = 'read') {
  if (!handle?.queryPermission) return false;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

/** Camera time from EXIF (DateTimeOriginal + sub-seconds). Returns { cameraMs, camera } or null. */
const EXIF_PICK = ['DateTimeOriginal', 'SubSecTimeOriginal', 'CreateDate', 'ModifyDate', 'Make', 'Model'];
const timeOf = (x) => x?.DateTimeOriginal || x?.CreateDate || x?.ModifyDate;

export async function readExifTime(file) {
  const ex = await exifr();
  let x = null;
  try { x = await ex.parse(file, { pick: EXIF_PICK }); } catch { x = null; }
  if (!(timeOf(x) instanceof Date) && (RAW_RE.test(file.name) || HEIC_RE.test(file.name))) {
    // Some RAW/HEIC files confuse the EXIF reader: find the EXIF block ourselves and read just that.
    try {
      const head = new Uint8Array(await file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).arrayBuffer());
      const at = findExifTiff(head);
      if (at >= 0) x = { ...(x || {}), ...(await ex.parse(head.subarray(at), { pick: EXIF_PICK })) };
    } catch { /* no time */ }
  }
  const d = timeOf(x);
  if (!(d instanceof Date) || isNaN(d)) return null;
  let ms = d.getTime();
  if (x.SubSecTimeOriginal != null) {
    const digits = String(x.SubSecTimeOriginal).replace(/\D/g, '');
    if (digits) ms += Math.round(Number(`0.${digits}`) * 1000);
  }
  return { cameraMs: ms, camera: [x.Make, x.Model].filter(Boolean).join(' ').trim() };
}

// ---------- previews (JPEG, RAW, HEIC) ----------
/** Small LRU cache of object URLs so memory stays flat with thousands of photos. */
function lru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) {
      m.set(k, v);
      while (m.size > max) {
        const [old, p] = m.entries().next().value;
        m.delete(old);
        Promise.resolve(p).then((u) => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
      }
    },
  };
}
const thumbCache = lru(1500);
const fullCache = lru(12);

async function orientationOf(file) {
  try { return (await (await exifr()).orientation(file)) || 1; } catch { return 1; }
}

/** A blob the browser can draw: JPEG as-is, HEIC decoded, RAW → its embedded preview. */
async function viewable(file, { quick = false } = {}) {
  if (isJpegLike(file)) return { blob: file, orient: 1, native: true };
  if (HEIC_RE.test(file.name)) {
    try { const b = await createImageBitmap(file); b.close?.(); return { blob: file, orient: 1, native: true }; } catch { /* not Safari */ }
    await loadScript('vendor/heic2any.min.js');
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.86 });
    return { blob: Array.isArray(out) ? out[0] : out, orient: 1 };
  }
  // RAW (and TIFF): the camera's own JPEG preview. Thumbnails only scan the start of the file.
  const orient = await orientationOf(file);
  const scan = async (limit) => {
    const bytes = new Uint8Array(await file.slice(0, limit).arrayBuffer());
    const j = largestJpeg(bytes);
    return j ? new Blob([bytes.subarray(j.start, j.end)], { type: 'image/jpeg' }) : null;
  };
  let blob = await scan(quick ? Math.min(file.size, 6 * 1024 * 1024) : file.size);
  if (!blob && quick && file.size > 6 * 1024 * 1024) blob = await scan(file.size);
  if (!blob) {
    const t = await (await exifr()).thumbnail(file).catch(() => null);
    if (t) blob = new Blob([t], { type: 'image/jpeg' });
  }
  return blob ? { blob, orient } : null;
}

/** Draw a bitmap upright and scaled to fit `max`, return a blob URL. */
async function canvasUrl(bmp, orient, max) {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const turn = [5, 6, 7, 8].includes(orient);
  const c = document.createElement('canvas');
  c.width = turn ? h : w; c.height = turn ? w : h;
  const g = c.getContext('2d');
  if (orient === 3 || orient === 4) { g.translate(w, h); g.rotate(Math.PI); }
  else if (orient === 6 || orient === 5) { g.translate(h, 0); g.rotate(Math.PI / 2); }
  else if (orient === 8 || orient === 7) { g.translate(0, w); g.rotate(-Math.PI / 2); }
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82)));
}

/** Small preview URL for grids. */
export function thumbUrl(id, file, size = 360) {
  const key = `${id}@${size}`;
  let p = thumbCache.get(key);
  if (!p) {
    p = (async () => {
      if (isJpegLike(file)) return canvasUrl(await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'medium' }), 1, size);
      const v = await viewable(file, { quick: true });
      return v ? canvasUrl(await createImageBitmap(v.blob), v.orient, size) : '';
    })().catch(() => '');
    thumbCache.set(key, p);
  }
  return p;
}

/** Full-size URL for the viewer (JPEGs are shown directly; RAW/HEIC are decoded once and cached). */
export function fullUrl(id, file) {
  let p = fullCache.get(id);
  if (!p) {
    p = (async () => {
      const v = await viewable(file);
      if (!v) return '';
      if (v.native || v.orient === 1) return URL.createObjectURL(v.blob);
      return canvasUrl(await createImageBitmap(v.blob), v.orient, 4000);
    })().catch(() => '');
    fullCache.set(id, p);
  }
  return p;
}

/** Try to read the phone-clock QR code from a photo. Returns the decoded text or null. */
export async function decodeQr(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'high' }); } catch {
    try { const u = await (await exifr()).thumbnailUrl(file); if (!u) return null; bmp = await createImageBitmap(await (await fetch(u)).blob()); } catch { return null; }
  }
  if ('BarcodeDetector' in window) {
    try {
      const r = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch { /* fall back to ZXing */ }
  }
  await loadScript('vendor/html5-qrcode.min.js');
  const lib = window.__Html5QrcodeLibrary__;
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  const el = document.createElement('div');
  el.id = `qr-scratch-${Math.random().toString(36).slice(2)}`;
  el.style.display = 'none';
  document.body.appendChild(el);
  const h = new lib.Html5Qrcode(el.id, { formatsToSupport: [lib.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
  try { return await h.scanFile(new File([blob], 'clock.jpg', { type: 'image/jpeg' }), false); } catch { return null; } finally { try { h.clear(); } catch { /* ignore */ } el.remove(); }
}

/** Write a file into a directory handle (creating sub-folders). */
export async function writeFile(dir, path, data) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(parts.at(-1), { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
