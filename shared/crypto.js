// Small crypto helpers that work the same in every browser (and in Node for the tests).
// SHA-256 and HMAC are written out here so HQ can use them instantly (no waiting);
// Agents check signatures with the browser's own WebCrypto, which must agree with this.
import { canonical } from './canonical.js';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const enc = new TextEncoder();
const bytes = (x) => (x instanceof Uint8Array ? x : enc.encode(String(x)));

/** SHA-256 of a string or bytes → 32 bytes. */
export function sha256Bytes(input) {
  const m = bytes(input);
  const l = m.length, n = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(n);
  buf.set(m); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n - 8, Math.floor((l * 8) / 2 ** 32)); dv.setUint32(n - 4, (l * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const r = (x, s) => (x >>> s) | (x << (32 - s));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const b64url = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sha256 = (s) => hex(sha256Bytes(s));

/** HMAC-SHA256(key, message) → base64url. */
export function hmac(key, message) {
  let k = bytes(key);
  if (k.length > 64) k = sha256Bytes(k);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = (k[i] || 0) ^ 0x36; opad[i] = (k[i] || 0) ^ 0x5c; }
  const m = bytes(message);
  const inner = new Uint8Array(64 + m.length); inner.set(ipad); inner.set(m, 64);
  const ih = sha256Bytes(inner);
  const outer = new Uint8Array(96); outer.set(opad); outer.set(ih, 64);
  return b64url(sha256Bytes(outer));
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomToken = (n = 32) => b64url(randomBytes(n));
export const newId = () => crypto.randomUUID();

// Easy to type on a phone: 6 characters, no look-alikes (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function pairCode(len = 6) { let s = ''; for (const b of randomBytes(len)) s += CODE_CHARS[b % CODE_CHARS.length]; return s; }
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Every order HQ sends an Agent is signed with that Agent's own secret, timestamped and numbered once. */
export function signCommand(secret, cmd) {
  const body = { ...cmd, ts: Date.now(), nonce: randomToken(9) };
  return { ...body, sig: hmac(secret, canonical(body)) };
}

export const CODENAMES = ['FALCON', 'RAVEN', 'VIPER', 'LYNX', 'KESTREL', 'COBRA', 'OSPREY', 'PANTHER', 'MANTIS', 'JACKAL', 'HAWK', 'ORCA', 'WOLF', 'SPECTRE', 'CIPHER', 'ONYX', 'NOMAD', 'PHANTOM', 'ROOK', 'SPARROW', 'BADGER', 'COYOTE', 'HERON', 'MAGPIE', 'OTTER', 'PUMA', 'SHRIKE', 'TALON', 'VIXEN', 'ZEPHYR'];
const randInt = (n) => randomBytes(4).reduce((a, b) => a * 256 + b, 0) % n;
export function pickCodename(taken) {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  const free = CODENAMES.filter((c) => !used.has(c));
  if (free.length) return free[randInt(free.length)];
  for (let n = 2; ; n++) { const c = `${CODENAMES[randInt(CODENAMES.length)]}-${n}`; if (!used.has(c)) return c; }
}
export const agentLabel = (a) => `AGENT-${String(a.number).padStart(2, '0')}`;
