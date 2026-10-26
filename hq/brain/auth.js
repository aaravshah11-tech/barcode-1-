// Director login: codename + PIN.
//  - The PIN is never stored, only a slow salted hash of it (PBKDF2, 200,000 rounds).
//  - 5 wrong tries locks login for 1 minute, then 2, 4, 8… (survives reloading the page).
//  - Linked phones get a session that ends after the auto-lock time without use.
import { randomToken, b64url } from '../../shared/crypto.js';

const ITER = 200000;
const enc = new TextEncoder();
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hashPin(pin, salt, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return b64url(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
export const cleanCodename = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 24);
const validPin = (p) => /^\d{4,8}$/.test(String(p || ''));

export function makeAuth({ db, now = () => Date.now(), idleMin = () => 15 }) {
  const sessions = new Map(); // session -> lastUsed

  const record = () => db.getSetting('director', null);
  const lockState = () => db.getSetting('authLock', { fails: 0, until: 0 });

  async function check(codename, pin) {
    const r = record();
    if (!r) throw fail(409, 'No Director set up yet.');
    const lk = lockState();
    if (lk.until > now()) throw fail(429, `Too many wrong tries. Try again in ${Math.ceil((lk.until - now()) / 1000)} s.`, { retryIn: lk.until - now() });
    const ok = cleanCodename(codename) === r.codename & same(await hashPin(pin, fromB64(r.salt), r.iter), r.hash);
    if (!ok) {
      const fails = lk.fails + 1;
      const until = fails % 5 === 0 ? now() + 60000 * 2 ** (fails / 5 - 1) : 0;
      db.setSetting('authLock', { fails, until });
      throw fail(401, until ? `ACCESS DENIED. Locked for ${Math.round((until - now()) / 60000)} min.` : `ACCESS DENIED. ${5 - (fails % 5)} tries left.`);
    }
    db.setSetting('authLock', { fails: 0, until: 0 });
    return r;
  }

  return {
    status: () => ({ setup: !!record(), lockedFor: Math.max(0, lockState().until - now()) }),
    async setup({ codename, pin }) {
      if (record()) throw fail(409, 'A Director is already set up.');
      const c = cleanCodename(codename);
      if (c.length < 2) throw fail(400, 'Pick a codename (2–24 letters/numbers).');
      if (!validPin(pin)) throw fail(400, 'The PIN must be 4–8 digits.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      db.setSetting('director', { codename: c, salt: b64url(salt), hash: await hashPin(pin, salt), iter: ITER, createdAt: now() });
      return { ok: true, codename: c };
    },
    /** Returns a new session key if the codename and PIN are right. */
    async unlock({ codename, pin }) {
      const r = await check(codename, pin);
      const session = randomToken(24);
      sessions.set(session, now());
      return { ok: true, session, codename: r.codename };
    },
    async change({ codename, pin, newCodename, newPin }) {
      const r = await check(codename, pin);
      const c = newCodename ? cleanCodename(newCodename) : r.codename;
      if (c.length < 2) throw fail(400, 'Pick a codename (2–24 letters/numbers).');
      if (newPin != null && newPin !== '' && !validPin(newPin)) throw fail(400, 'The new PIN must be 4–8 digits.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      db.setSetting('director', { ...r, codename: c, ...(newPin ? { salt: b64url(salt), hash: await hashPin(newPin, salt), iter: ITER } : {}) });
      sessions.clear(); // everyone logs in again
      return { ok: true, codename: c };
    },
    /** Is this session still valid? (Using it keeps it alive.) */
    valid(session) {
      if (!session || !sessions.has(session)) return false;
      const idle = idleMin();
      if (idle && now() - sessions.get(session) > idle * 60000) { sessions.delete(session); return false; }
      sessions.set(session, now());
      return true;
    },
    lock(session) { sessions.delete(session); },
  };
}
