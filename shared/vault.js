// ENCRYPTION helpers (AES-256-GCM via the browser's WebCrypto).
//  - Data at rest is sealed with a "device key" that the browser keeps and will not let anyone copy out.
//  - Backup files you download are sealed with a key made from a backup password you choose
//    (PBKDF2, 200,000 rounds), so they can be restored on another computer — and only with that password.
const enc = new TextEncoder(), dec = new TextDecoder();
export const b64 = (u8) => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newDeviceKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

/** Seal bytes or text. Returns { iv, ct } (base64). */
export async function seal(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) };
}
export async function openBytes(key, rec) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct))); }
export async function openText(key, rec) { return dec.decode(await openBytes(key, rec)); }
export const sealJSON = (key, obj) => seal(key, JSON.stringify(obj));
export async function openJSON(key, rec) { return JSON.parse(await openText(key, rec)); }

/** A key from a password (for backup files). */
export async function passwordKey(password, salt, iterations = 200000) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** An encrypted backup file's contents (text). */
export async function sealBackup(backup, password, meta = {}) {
  if (String(password || '').length < 8) throw Object.assign(new Error('Choose a backup password of at least 8 characters.'), { status: 400 });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await passwordKey(password, salt);
  const sealed = await sealJSON(key, backup);
  return JSON.stringify({ sentinel: 'hq-backup-encrypted', version: 1, at: backup.at, ...meta, kdf: { name: 'PBKDF2-SHA256', iterations: 200000, salt: b64(salt) }, cipher: 'AES-256-GCM', ...sealed });
}
export async function openBackup(text, password) {
  let f;
  try { f = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw Object.assign(new Error('That isn’t a SENTINEL backup file.'), { status: 400 }); }
  if (f?.sentinel === 'hq-backup') return f; // an older, unencrypted backup
  if (f?.sentinel !== 'hq-backup-encrypted') throw Object.assign(new Error('That isn’t a SENTINEL backup file.'), { status: 400 });
  const key = await passwordKey(password, unb64(f.kdf.salt), f.kdf.iterations);
  try { return await openJSON(key, f); } catch { throw Object.assign(new Error('Wrong backup password (or the file is damaged).'), { status: 400 }); }
}
