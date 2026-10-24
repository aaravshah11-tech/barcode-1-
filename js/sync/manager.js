// Sync manager: one place the UI asks "are we connected?" and "show me a pairing QR".
//   • Cloud (Supabase) when it's set up: works anywhere, keeps data in the cloud.
//   • Quick link (public relays) otherwise: zero setup, both devices must be open.
import * as sb from './supabase.js';
import * as relay from './relay.js';

const subs = new Set();
export const mode = () => (sb.isConfigured() ? 'cloud' : relay.getState().role ? 'relay' : 'off');

export function getState() {
  if (sb.isConfigured()) return sb.getState();
  const r = relay.getState();
  return { ...r, mode: r.role ? 'relay' : 'off' };
}
export function onState(fn) { subs.add(fn); return () => subs.delete(fn); }
const notify = () => { const s = getState(); subs.forEach((f) => { try { f(s); } catch (e) { console.error(e); } }); };
sb.onState(notify);
relay.onState(notify);

export function start() {
  if (sb.isConfigured()) sb.start();
  else relay.autoStart();
}

// ---------- pairing links ----------
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export const appBase = () => location.href.split('#')[0];

/** URL for the pairing QR code (opens HomeBase on the phone and pairs it). */
export function pairingUrl() {
  if (sb.isConfigured()) return `${appBase()}#/pair/${b64url(JSON.stringify(sb.pairingPayload()))}`;
  const code = relay.getState().code;
  return code ? `${appBase()}#/link/${code}` : '';
}

/** Read a pairing QR / link. Returns { type: 'cloud', ... } | { type: 'relay', code } | null */
export function parsePairing(text) {
  const t = String(text || '');
  const m = t.match(/#\/pair\/([A-Za-z0-9_-]+)/);
  if (m) {
    try {
      const p = JSON.parse(unb64url(m[1]));
      if (p.t === 'sb' && p.u && p.k && p.h && p.j) return { type: 'cloud', url: p.u, key: p.k, householdId: p.h, joinCode: p.j };
    } catch { /* fall through */ }
  }
  const code = relay.codeFromText(t);
  return code ? { type: 'relay', code } : null;
}

/** Pair this device using a scanned/opened pairing link. */
export async function pairWith(p) {
  if (p.type === 'cloud') {
    await relay.unlink();
    await sb.joinHousehold(p);
  } else {
    await relay.connectTo(p.code);
  }
  notify();
}

export const isPhoneSide = () => (sb.isConfigured() ? sb.config()?.role === 'guest' : relay.getState().role === 'guest');
export { sb, relay };
