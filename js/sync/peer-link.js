// ============================================================
// Device link: phone <-> computer, peer to peer (WebRTC via PeerJS).
//
// The computer "hosts" with a short pairing code. The phone
// connects to that code. Both sides swap a manifest of what they
// have, send each other anything newer, then stream every change
// live. Each device keeps a full copy, so both still work offline.
//
// This only talks to store.js (manifest / recordsNewerThan /
// mergeRecords / onChange). A cloud sync (e.g. Supabase) can be
// added the same way, as a sibling module.
// ============================================================
import * as store from '../store.js';
import { loadScript } from '../ui.js';

const PREFIX = 'shelf-home-library-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BATCH = 40;

let peer = null;
let role = null; // 'host' | 'guest' | null
let state = 'off'; // off | connecting | waiting | connected | error
let message = '';
let retryTimer = null;
let retries = 0;
const conns = new Map(); // peerId -> { conn, name }
const subs = new Set();

export const getState = () => ({
  state,
  role,
  message,
  code: role === 'host' ? store.getSetting('hostCode') : role === 'guest' ? store.getSetting('linkedHost') : '',
  devices: [...conns.values()].map((c) => c.name),
});

export function onState(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function setState(s, msg = '') {
  state = s;
  message = msg;
  const snap = getState();
  subs.forEach((fn) => { try { fn(snap); } catch (e) { console.error(e); } });
}

export const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return 'Computer';
};

export function genCode() {
  let s = '';
  for (const x of crypto.getRandomValues(new Uint8Array(6))) s += ALPHABET[x % ALPHABET.length];
  return s;
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Pull a pairing code out of a scanned QR (a Shelf link URL) or typed text. */
export function codeFromText(text) {
  const m = String(text || '').match(/#\/link\/([A-Za-z0-9]{4,12})/);
  if (m) return normalizeCode(m[1]);
  const c = normalizeCode(text);
  return /^[A-Z0-9]{6}$/.test(c) ? c : '';
}

export const pairingUrl = (code) => `${location.href.split('#')[0]}#/link/${code}`;

function peerOptions() {
  const opts = { debug: 0 };
  try {
    // Optional: point at your own PeerJS server (also used by the automated tests).
    const custom = JSON.parse(localStorage.getItem('shelf.peerServer') || 'null');
    if (custom) Object.assign(opts, custom);
  } catch { /* ignore */ }
  return opts;
}

async function ensureLib() {
  if (!window.Peer) await loadScript('vendor/peerjs.min.js');
}

function teardown() {
  clearTimeout(retryTimer);
  retryTimer = null;
  for (const { conn } of conns.values()) { try { conn.close(); } catch { /* ignore */ } }
  conns.clear();
  if (peer) {
    const p = peer;
    peer = null;
    try { p.destroy(); } catch { /* ignore */ }
  }
}

function scheduleRetry(fn, msg) {
  clearTimeout(retryTimer);
  const delay = Math.min(30000, 2000 * 2 ** Math.min(retries, 4));
  retries++;
  setState(state === 'connected' ? 'connecting' : state === 'off' ? 'connecting' : state, msg || message);
  retryTimer = setTimeout(fn, delay);
}

// ---------- host (computer) ----------
export async function startHosting({ newCode = false } = {}) {
  await ensureLib();
  teardown();
  role = 'host';
  let code = store.getSetting('hostCode');
  if (!code || newCode) {
    code = genCode();
    await store.setSetting('hostCode', code);
  }
  await store.setSetting('hosting', true);
  await store.setSetting('linkedHost', null);
  setState('connecting', 'Getting a pairing code…');
  const p = (peer = new window.Peer(PREFIX + code, peerOptions()));
  p.on('open', () => {
    if (peer !== p) return;
    retries = 0;
    setState(conns.size ? 'connected' : 'waiting', conns.size ? '' : 'Waiting for your phone…');
  });
  p.on('connection', (conn) => wire(conn));
  p.on('disconnected', () => {
    if (peer === p && !p.destroyed) setTimeout(() => { if (peer === p && !p.destroyed && p.disconnected) p.reconnect(); }, 2000);
  });
  p.on('error', (err) => onPeerError(err, p));
}

// ---------- guest (phone) ----------
export async function connectTo(code) {
  code = normalizeCode(code);
  if (!code) return;
  await ensureLib();
  teardown();
  role = 'guest';
  await store.setSetting('linkedHost', code);
  await store.setSetting('hosting', false);
  setState('connecting', 'Connecting to your computer…');
  const p = (peer = new window.Peer(peerOptions()));
  p.on('open', () => { if (peer === p) dial(code); });
  p.on('disconnected', () => {
    if (peer === p && !p.destroyed) setTimeout(() => { if (peer === p && !p.destroyed && p.disconnected) p.reconnect(); }, 2000);
  });
  p.on('error', (err) => onPeerError(err, p));
}

function dial(code) {
  if (!peer || peer.destroyed) return;
  const conn = peer.connect(PREFIX + code, { reliable: true, metadata: { name: deviceName() } });
  wire(conn);
}

function reconnectGuest() {
  const code = store.getSetting('linkedHost');
  if (role !== 'guest' || !code) return;
  if (peer && !peer.destroyed && !peer.disconnected && peer.open) dial(code);
  else connectTo(code);
}

function onPeerError(err, p) {
  if (peer !== p) return;
  const t = err?.type;
  console.warn('[link]', t, err?.message);
  if (role === 'host' && t === 'unavailable-id') {
    // Usually our own previous session that hasn't timed out yet.
    scheduleRetry(() => startHosting(), 'Pairing code still in use, retrying…');
  } else if (role === 'guest' && t === 'peer-unavailable') {
    setState('error', 'Can’t find your computer. Open Shelf on it and go to Settings › Link phone & computer.');
    scheduleRetry(reconnectGuest);
  } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(t)) {
    setState('error', navigator.onLine === false ? 'You’re offline. Will reconnect when you’re back online.' : 'Can’t reach the linking service. Retrying…');
    scheduleRetry(() => (role === 'host' ? startHosting() : reconnectGuest()));
  } else if (t === 'browser-incompatible') {
    setState('error', 'This browser can’t link devices. Try Chrome, Safari or Edge.');
  } else {
    setState('error', err?.message || 'Link error');
    scheduleRetry(() => (role === 'host' ? startHosting() : reconnectGuest()));
  }
}

// ---------- connection plumbing ----------
function send(conn, msg) {
  try { if (conn.open) conn.send(msg); } catch (e) { console.warn('[link] send failed', e); }
}

function sendRecords(conn, recs) {
  const flat = [];
  for (const store of ['rooms', 'meta', 'books']) for (const r of recs[store] || []) flat.push([store, r]);
  for (let i = 0; i < flat.length; i += BATCH) {
    const d = {};
    for (const [s, r] of flat.slice(i, i + BATCH)) (d[s] ||= []).push(r);
    send(conn, { t: 'records', d });
  }
}

function wire(conn) {
  conn.on('open', () => {
    if (role === 'guest') {
      // A guest only keeps one connection.
      for (const [id, c] of conns) if (id !== conn.peer) { try { c.conn.close(); } catch { /* ignore */ } conns.delete(id); }
    }
    conns.set(conn.peer, { conn, name: conn.metadata?.name || (role === 'guest' ? 'Computer' : 'Device') });
    retries = 0;
    clearTimeout(retryTimer);
    setState('connected');
    send(conn, { t: 'hello', name: deviceName() });
    send(conn, { t: 'manifest', m: store.manifest() });
  });
  conn.on('data', (msg) => handle(conn, msg));
  conn.on('close', () => {
    if (!conns.has(conn.peer) || conns.get(conn.peer).conn !== conn) return;
    conns.delete(conn.peer);
    if (role === 'guest') {
      setState('connecting', 'Reconnecting to your computer…');
      scheduleRetry(reconnectGuest);
    } else if (role === 'host') {
      setState(conns.size ? 'connected' : 'waiting', conns.size ? '' : 'Waiting for your phone…');
    }
  });
  conn.on('error', (e) => console.warn('[link] connection error', e));
}

async function handle(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const entry = conns.get(conn.peer);
  if (msg.t === 'hello' && entry) {
    entry.name = String(msg.name || entry.name).slice(0, 40);
    setState(state, message);
  } else if (msg.t === 'manifest') {
    sendRecords(conn, store.recordsNewerThan(msg.m));
  } else if (msg.t === 'records') {
    await store.mergeRecords(msg.d, conn.peer);
  }
}

// Stream every change to the other devices (never back to whoever sent it).
store.onChange(({ changes, source }) => {
  if (!conns.size) return;
  const recs = {};
  for (const { store: s, record } of changes) {
    if (s === 'meta' && record.local) continue;
    (recs[s] ||= []).push(record);
  }
  if (!Object.keys(recs).length) return;
  for (const [id, { conn }] of conns) if (id !== source) sendRecords(conn, recs);
});

export const peerNameOf = (peerId) => conns.get(peerId)?.name || '';

// ---------- public controls ----------
export async function unlink() {
  teardown();
  role = null;
  await store.setSetting('hosting', false);
  await store.setSetting('linkedHost', null);
  setState('off');
}

/** Resume whatever link was active last time the app was open. */
export function autoStart() {
  if (store.getSetting('hosting')) startHosting().catch((e) => setState('error', e.message));
  else if (store.getSetting('linkedHost')) connectTo(store.getSetting('linkedHost')).catch((e) => setState('error', e.message));

  const kick = () => {
    if (role && state !== 'connected') {
      retries = 0;
      if (role === 'host') { if (!peer || peer.destroyed || peer.disconnected) startHosting(); }
      else reconnectGuest();
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  window.addEventListener('online', kick);
}
