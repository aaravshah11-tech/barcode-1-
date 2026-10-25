// Small security helpers: random tokens, password hashing, pairing codes, signed commands, codenames.
import crypto from 'node:crypto';
import { canonical } from '../public/shared/canonical.js';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const newId = () => crypto.randomUUID();

// ---------- admin password (scrypt, salted) ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

// ---------- one-time pairing codes ----------
// Easy to type on a phone: 6 characters, no look-alikes (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function pairCode(len = 6) {
  let s = '';
  for (const b of crypto.randomBytes(len)) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- signed commands ----------
// HQ and each Agent share a secret (the Agent's token). Every command HQ sends carries a signature
// made with that secret, a timestamp and a one-off nonce, so an Agent can tell it really came from
// its own HQ and isn't an old message being replayed.
export function signCommand(secret, cmd) {
  const body = { ...cmd, ts: Date.now(), nonce: randomToken(9) };
  const sig = crypto.createHmac('sha256', secret).update(canonical(body)).digest('base64url');
  return { ...body, sig };
}
export function verifyCommand(secret, msg, { maxAgeMs = 60000, now = Date.now() } = {}) {
  if (!msg || typeof msg.sig !== 'string') return false;
  const { sig, ...body } = msg;
  const want = crypto.createHmac('sha256', secret).update(canonical(body)).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return false;
  return Math.abs(now - body.ts) <= maxAgeMs;
}
export { canonical };

// ---------- codenames ----------
export const CODENAMES = ['FALCON', 'RAVEN', 'VIPER', 'LYNX', 'KESTREL', 'COBRA', 'OSPREY', 'PANTHER', 'MANTIS', 'JACKAL', 'HAWK', 'ORCA', 'WOLF', 'SPECTRE', 'CIPHER', 'ONYX', 'NOMAD', 'PHANTOM', 'ROOK', 'SPARROW', 'BADGER', 'COYOTE', 'HERON', 'MAGPIE', 'OTTER', 'PUMA', 'SHRIKE', 'TALON', 'VIXEN', 'ZEPHYR'];
export function pickCodename(taken) {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  const free = CODENAMES.filter((c) => !used.has(c));
  if (free.length) return free[crypto.randomInt(free.length)];
  let n = 2;
  for (;;) { const c = `${CODENAMES[crypto.randomInt(CODENAMES.length)]}-${n}`; if (!used.has(c)) return c; n++; }
}
export const agentLabel = (a) => `AGENT-${String(a.number).padStart(2, '0')}`;

/**
 * Did this request come from a page served by HQ itself? (Blocks other websites from talking to HQ.)
 * Behind `tailscale serve` the original address arrives as X-Forwarded-Host; a web page can't fake that header.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return host === req.headers.host || (!!req.headers['x-forwarded-host'] && host === String(req.headers['x-forwarded-host']).split(',')[0].trim());
}

/** Is this request from the HQ computer itself (not forwarded by Tailscale or another proxy)? */
export const isLocalRequest = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  && !req.headers['x-forwarded-for'] && !req.headers['tailscale-user-login'];
