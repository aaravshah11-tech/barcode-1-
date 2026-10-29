// TWO-STEP SIGN-IN: time-based one-time codes (RFC 6238), the 6-digit codes that authenticator apps
// (Google Authenticator, Microsoft Authenticator, 1Password…) show. Uses the browser's WebCrypto.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export const newSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

/** The code for one 30-second step. */
export async function hotp(secret, counter, digits = 6) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const stepOf = (now = Date.now()) => Math.floor(now / 30000);

/** Checks a code, allowing one step either side for clock drift. Returns the step that matched, or null. */
export async function verifyTotp(secret, code, now = Date.now(), lastStep = -1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const s = stepOf(now);
  for (const k of [s, s - 1, s + 1]) if (k > lastStep && (await hotp(secret, k)) === c) return k;
  return null;
}
/** The link an authenticator app reads from a QR code. */
export const otpauthUri = (secret, account, issuer = 'SENTINEL') => `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
