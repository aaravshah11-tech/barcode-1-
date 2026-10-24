// Reading photos on the computer: folder access, EXIF times, thumbnails, QR decoding.
// Nothing here uploads anything — files are read locally in the browser.
import * as store from '../../core/store.js';
import { loadScript } from '../../core/ui.js';

export const IMAGE_RE = /\.(jpe?g|png|heic|heif|tiff?|cr2|cr3|nef|arw|raf|orf|rw2|dng|pef|srw)$/i;
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
export async function readExifTime(file) {
  const ex = await exifr();
  let x = null;
  try { x = await ex.parse(file, { pick: ['DateTimeOriginal', 'SubSecTimeOriginal', 'CreateDate', 'Make', 'Model'] }); } catch { x = null; }
  const d = x?.DateTimeOriginal || x?.CreateDate;
  if (!(d instanceof Date) || isNaN(d)) return null;
  let ms = d.getTime();
  if (x.SubSecTimeOriginal != null) {
    const digits = String(x.SubSecTimeOriginal).replace(/\D/g, '');
    if (digits) ms += Math.round(Number(`0.${digits}`) * 1000);
  }
  return { cameraMs: ms, camera: [x.Make, x.Model].filter(Boolean).join(' ').trim() };
}

const thumbCache = new Map();
/** Small preview URL (JPEG/PNG resized in the browser; RAW uses the embedded preview). */
export async function thumbUrl(id, file, size = 360) {
  const key = `${id}@${size}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let url = '';
  try {
    if (isJpegLike(file)) {
      const bmp = await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'medium' });
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      url = URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)));
    } else {
      url = (await (await exifr()).thumbnailUrl(file)) || '';
    }
  } catch { url = ''; }
  thumbCache.set(key, url);
  return url;
}

/** Full-size URL for the viewer. */
export async function fullUrl(id, file) {
  if (isJpegLike(file)) return thumbUrl(id, file, 2400);
  return thumbUrl(id, file, 2400);
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
