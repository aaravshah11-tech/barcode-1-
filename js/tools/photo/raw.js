// Find the big JPEG preview that cameras embed inside RAW files (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG…).
// Pure byte-scanning, no libraries. Unit tested.

const BASELINE_SOF = new Set([0xC0, 0xC1, 0xC2]); // browsers can show these; lossless (C3…) is raw sensor data

/** Parse one JPEG starting at `start` (bytes FF D8). Returns { start, end, width, height } or null. */
export function parseJpeg(bytes, start) {
  const n = bytes.length;
  let p = start + 2;
  let width = 0, height = 0, sof = false;
  while (p < n) {
    if (bytes[p] !== 0xFF) return null;
    while (p < n && bytes[p] === 0xFF) p++; // fill bytes
    const m = bytes[p++];
    if (m === 0xD9) return sof ? { start, end: p, width, height } : null;
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) continue; // markers without a length
    if (p + 2 > n) return null;
    const len = (bytes[p] << 8) | bytes[p + 1];
    if (len < 2) return null;
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      if (!BASELINE_SOF.has(m)) return null; // lossless / unsupported
      height = (bytes[p + 3] << 8) | bytes[p + 4];
      width = (bytes[p + 5] << 8) | bytes[p + 6];
      sof = true;
    }
    p += len;
    if (m === 0xDA) {
      // Image data: runs until a real marker (FF not followed by 00, a restart marker or more FF).
      while (p < n - 1) {
        if (bytes[p] === 0xFF) {
          const nx = bytes[p + 1];
          if (nx === 0x00 || (nx >= 0xD0 && nx <= 0xD7)) { p += 2; continue; }
          if (nx === 0xFF) { p += 1; continue; }
          break;
        }
        p++;
      }
    }
  }
  return null;
}

/** All complete, viewable JPEGs inside a byte array (first `limit` bytes). */
export function findJpegs(bytes, limit = bytes.length) {
  const out = [];
  const n = Math.min(limit, bytes.length) - 3;
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== 0xFF || bytes[i + 1] !== 0xD8 || bytes[i + 2] !== 0xFF) continue;
    const j = parseJpeg(bytes, i);
    if (j) { out.push(j); i = j.end - 1; }
  }
  return out;
}

/** The biggest preview (by pixels, then by bytes). */
export function largestJpeg(bytes, limit) {
  let best = null;
  for (const j of findJpegs(bytes, limit)) {
    if (!best || j.width * j.height > best.width * best.height || (j.width * j.height === best.width * best.height && j.end - j.start > best.end - best.start)) best = j;
  }
  return best;
}

export const RAW_RE = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|dng|pef|srw|x3f|3fr|iiq|erf|kdc|mrw)$/i;
export const HEIC_RE = /\.(heic|heif)$/i;

/** Find the EXIF (TIFF) block in any file: "Exif\0\0" followed by "MM\0*" or "II*\0". Returns its start or -1. */
export function findExifTiff(bytes) {
  for (let i = 0; i < bytes.length - 10; i++) {
    if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x66 && bytes[i + 4] === 0 && bytes[i + 5] === 0) {
      const a = bytes[i + 6], b = bytes[i + 7], c = bytes[i + 8], d = bytes[i + 9];
      if ((a === 0x4D && b === 0x4D && c === 0 && d === 0x2A) || (a === 0x49 && b === 0x49 && c === 0x2A && d === 0)) return i + 6;
    }
  }
  return -1;
}
