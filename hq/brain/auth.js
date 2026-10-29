// Sign-in: username + PIN or password, optional two-step code (authenticator app).
//  - PINs are never stored, only a slow salted hash (PBKDF2, 200,000 rounds).
//  - 5 wrong tries locks sign-in for 1 minute, then 2, 4, 8… (survives reloading the page).
//  - Users have a role: DIRECTOR (the first account), OPERATOR or OBSERVER.
//  - Every sign-in is a session; the Director can see and end sessions. Idle sessions end by themselves.
import { randomToken, b64url, sha256 } from '../../shared/crypto.js';
import { newSecret, verifyTotp, otpauthUri, stepOf } from '../../shared/totp.js';

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
/** 'weak' for anything shorter than 6 characters. */
export const pinStrength = (p) => (String(p || '').length < 6 ? 'weak' : 'ok');
const validPin = (p) => String(p || '').length >= 4 && String(p || '').length <= 64; // a PIN or a password
const publicUser = (u) => ({ username: u.codename, role: u.role, createdAt: u.createdAt, createdBy: u.createdBy || null, disabled: !!u.disabled, twoFactor: !!u.totp?.enabled, strength: u.strength || null, lastLogin: u.lastLogin || null });
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

export function makeAuth({ db, now = () => Date.now(), idleMin = () => 15 }) {
  const sessions = new Map(); // session key -> { id, at, codename, role, started, via }

  /** Users (the first one is the Director). Older HQs had a single 'director' record: move it across. */
  function users() {
    let list = db.getSetting('users', null);
    if (!list) {
      const d = db.getSetting('director', null);
      list = d ? [{ ...d, role: 'DIRECTOR' }] : [];
      if (d) db.setSetting('users', list);
    }
    return list;
  }
  const saveUsers = (list) => { db.setSetting('users', list); const d = list.find((u) => u.role === 'DIRECTOR'); if (d) db.setSetting('director', d); };
  const find = (codename) => users().find((u) => u.codename === cleanCodename(codename));
  const lockState = () => db.getSetting('authLock', { fails: 0, until: 0 });
  const failed = (lk) => {
    const fails = lk.fails + 1;
    const until = fails % 5 === 0 ? now() + 60000 * 2 ** (fails / 5 - 1) : 0;
    db.setSetting('authLock', { fails, until });
    return { fails, until };
  };

  async function check(codename, pin, otp, { forUnlock = false } = {}) {
    if (!users().length) throw fail(409, 'No Director set up yet.');
    const lk = lockState();
    if (lk.until > now()) throw fail(429, `Too many failed attempts. Try again in ${Math.ceil((lk.until - now()) / 1000)} s.`, { retryIn: lk.until - now() });
    const u = find(codename);
    // always do the slow hash, so a wrong username takes as long as a wrong PIN
    const good = same(await hashPin(pin, fromB64(u?.salt || DUMMY_SALT), u?.iter || ITER), u?.hash || '-');
    if (!u || !good || u.disabled) {
      const { fails, until } = failed(lk);
      throw fail(401, until ? `Incorrect username or password. Sign-in locked for ${Math.round((until - now()) / 60000)} min.` : `Incorrect username or password. ${5 - (fails % 5)} attempt${5 - (fails % 5) === 1 ? '' : 's'} remaining.`);
    }
    if (forUnlock && u.totp?.enabled) {
      if (!otp) throw fail(401, 'Enter the 6-digit code from your authenticator app.', { needOtp: true });
      const step = await verifyTotp(u.totp.secret, otp, now(), u.totp.lastStep ?? -1);
      if (step == null) { failed(lk); throw fail(401, 'That code is wrong or has expired. Enter the current code.', { needOtp: true }); }
      saveUsers(users().map((x) => (x.codename === u.codename ? { ...x, totp: { ...x.totp, lastStep: step } } : x))); // a code works once
    }
    db.setSetting('authLock', { fails: 0, until: 0 });
    return u;
  }
  async function makeUser(codename, pin, role, by) {
    const c = cleanCodename(codename);
    if (c.length < 2) throw fail(400, 'Choose a username (2–24 letters or numbers).');
    if (!validPin(pin)) throw fail(400, 'The PIN or password must be at least 4 characters.');
    if (find(c)) throw fail(409, 'That username is taken.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { codename: c, role, salt: b64url(salt), hash: await hashPin(pin, salt), iter: ITER, createdAt: now(), createdBy: by, strength: pinStrength(pin) };
  }

  return {
    status: () => ({ setup: users().length > 0, lockedFor: Math.max(0, lockState().until - now()) }),
    async setup({ codename, pin }) {
      if (users().length) throw fail(409, 'A Director is already set up.');
      const u = await makeUser(codename, pin, 'DIRECTOR', 'setup');
      saveUsers([u]);
      return { ok: true, codename: u.codename };
    },
    /** Returns a new session key if the username, PIN (and two-step code, if on) are right. */
    async unlock({ codename, pin, otp }, via = 'HQ computer') {
      const u = await check(codename, pin, otp, { forUnlock: true });
      const session = randomToken(24);
      sessions.set(session, { id: sha256(session).slice(0, 10), at: now(), started: now(), codename: u.codename, role: u.role, via: String(via).slice(0, 40) });
      saveUsers(users().map((x) => (x.codename === u.codename ? { ...x, lastLogin: now() } : x)));
      return { ok: true, session, codename: u.codename, role: u.role };
    },
    /** Change your own username and/or PIN (needs the current PIN). */
    async change({ codename, pin, newCodename, newPin }) {
      const u = await check(codename, pin);
      const c = newCodename ? cleanCodename(newCodename) : u.codename;
      if (c.length < 2) throw fail(400, 'Choose a username (2–24 letters or numbers).');
      if (c !== u.codename && find(c)) throw fail(409, 'That username is taken.');
      if (newPin != null && newPin !== '' && !validPin(newPin)) throw fail(400, 'The new PIN or password must be at least 4 characters.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const next = { ...u, codename: c, ...(newPin ? { salt: b64url(salt), hash: await hashPin(newPin, salt), iter: ITER, strength: pinStrength(newPin) } : {}) };
      saveUsers(users().map((x) => (x.codename === u.codename ? next : x)));
      for (const [k, s] of sessions) if (s.codename === u.codename) sessions.delete(k); // sign in again everywhere
      return { ok: true, codename: c };
    },
    /** Is this session still valid? (Using it keeps it alive.) */
    valid(session) {
      if (!session || !sessions.has(session)) return false;
      const idle = idleMin(), s = sessions.get(session);
      if (idle && now() - s.at > idle * 60000) { sessions.delete(session); return false; }
      const u = find(s.codename);
      if (!u || u.disabled) { sessions.delete(session); return false; }
      s.at = now(); s.role = u.role; // a role change applies straight away
      return true;
    },
    session: (session) => (sessions.has(session) ? { ...sessions.get(session) } : null),
    /** Still valid? (Unlike valid(), checking doesn't count as using it.) */
    alive(session) {
      const s = session && sessions.get(session);
      if (!s) return false;
      const idle = idleMin();
      if (idle && now() - s.at > idle * 60000) { sessions.delete(session); return false; }
      const u = find(s.codename);
      return !!u && !u.disabled;
    },
    whoIs: (session) => sessions.get(session)?.codename || null,
    lock(session) { sessions.delete(session); },

    // ---------- users (Director only — the API checks the role) ----------
    users: () => users().map(publicUser),
    async addUser({ username, pin, role }, by) {
      if (!['OPERATOR', 'OBSERVER'].includes(role)) throw fail(400, 'New users are Operators or Observers. There is one Director.');
      const u = await makeUser(username, pin, role, by);
      saveUsers([...users(), u]);
      return publicUser(u);
    },
    updateUser(username, { role, disabled }) {
      const u = find(username);
      if (!u) throw fail(404, 'No such user.');
      if (u.role === 'DIRECTOR' && ((role && role !== 'DIRECTOR') || disabled)) throw fail(409, 'The Director can’t be demoted or disabled.');
      if (role && !['OPERATOR', 'OBSERVER'].includes(role)) throw fail(400, 'Choose Operator or Observer.');
      const next = { ...u, ...(role ? { role } : {}), ...(typeof disabled === 'boolean' ? { disabled } : {}) };
      saveUsers(users().map((x) => (x.codename === u.codename ? next : x)));
      if (next.disabled) for (const [k, s] of sessions) if (s.codename === u.codename) sessions.delete(k);
      return publicUser(next);
    },
    removeUser(username) {
      const u = find(username);
      if (!u) throw fail(404, 'No such user.');
      if (u.role === 'DIRECTOR') throw fail(409, 'The Director can’t be removed.');
      saveUsers(users().filter((x) => x.codename !== u.codename));
      for (const [k, s] of sessions) if (s.codename === u.codename) sessions.delete(k);
      return { ok: true };
    },

    // ---------- sessions ----------
    sessions(current = null) {
      const idle = idleMin();
      for (const [k, s] of sessions) if (idle && now() - s.at > idle * 60000) sessions.delete(k);
      return [...sessions].map(([k, s]) => ({ id: s.id, username: s.codename, role: s.role, via: s.via, started: s.started, lastActive: s.at, current: k === current }));
    },
    endSession(id) { for (const [k, s] of sessions) if (s.id === id) { sessions.delete(k); return { ok: true, username: s.codename }; } throw fail(404, 'That session has already ended.'); },
    endAll(except = null) { let n = 0; for (const k of [...sessions.keys()]) if (k !== except) { sessions.delete(k); n++; } return { ended: n }; },

    // ---------- two-step sign-in ----------
    async totpBegin(username, pin) {
      const u = await check(username, pin);
      const secret = newSecret();
      saveUsers(users().map((x) => (x.codename === u.codename ? { ...x, totpPending: secret } : x)));
      return { secret, uri: otpauthUri(secret, u.codename) };
    },
    async totpEnable(username, code) {
      const u = find(username);
      if (!u?.totpPending) throw fail(409, 'Start again: no set-up in progress.');
      const step = await verifyTotp(u.totpPending, code, now());
      if (step == null) throw fail(400, 'That code doesn’t match. Check the phone’s clock and enter the newest code.');
      const { totpPending, ...rest } = u;
      saveUsers(users().map((x) => (x.codename === u.codename ? { ...rest, totp: { secret: totpPending, enabled: true, lastStep: step, since: now() } } : x)));
      return { ok: true };
    },
    async totpDisable(username, pin) {
      const u = await check(username, pin);
      const { totp, totpPending, ...rest } = u;
      saveUsers(users().map((x) => (x.codename === u.codename ? rest : x)));
      return { ok: true };
    },
    director: () => users().find((u) => u.role === 'DIRECTOR') || null,
    _step: () => stepOf(now()),
  };
}
