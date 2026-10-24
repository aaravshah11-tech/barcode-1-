// ============================================================
// Device link: phone <-> computer through free public MQTT relays.
//
// Both devices join a private "room" on several public relays at
// once (EMQX, HiveMQ, Mosquitto), so if one is down the others
// still work. The room name and the encryption key are derived
// from the pairing code. Everything is encrypted (AES-GCM) before
// it leaves the device, so the relays only see scrambled bytes.
//
// On connect, devices swap a manifest of what they have, send each
// other anything newer, then stream every change live. Each device
// keeps a full copy, so both work offline and catch up later.
//
// This module only talks to store.js (manifest / recordsNewerThan /
// mergeRecords / onChange), so other sync methods can be added the
// same way.
// ============================================================
import * as store from '../store.js';
import { loadScript } from '../ui.js';

const DEFAULT_RELAYS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;
const CHUNK_CHARS = 48000; // keep each relay message small
const PEER_TIMEOUT = 75000; // a device is "gone" after this long without a word
const HEARTBEAT = 25000;

let role = null; // 'host' | 'guest' | null
let state = 'off'; // off | connecting | waiting | connected | error
let message = '';
let session = null; // { code, topic, key, clients: [], heartbeat, sweep }
const peers = new Map(); // deviceId -> { name, role, lastSeen }
const seen = new Map(); // message id -> time (dedupe across relays)
const subs = new Set();

// ---------- state ----------
export const getState = () => ({
  state,
  role,
  message,
  code: session?.code || '',
  devices: [...peers.values()].map((p) => p.name),
  relays: session ? session.clients.filter((c) => c.connected).length : 0,
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

function refreshState() {
  if (!session) return setState('off');
  const online = session.clients.some((c) => c.connected);
  if (peers.size) return setState('connected');
  if (!online) {
    return setState(session.everConnected ? 'error' : 'connecting',
      navigator.onLine === false ? 'You’re offline. Shelf will reconnect when you’re back online.'
        : session.everConnected ? 'Lost connection to the relays. Reconnecting…' : 'Connecting…');
  }
  setState('waiting', role === 'host' ? 'Waiting for your phone…' : 'Waiting for your computer. Open Shelf on it.');
}

// ---------- codes ----------
export const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return 'Computer';
};

export function genCode() {
  let s = '';
  for (const x of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) s += ALPHABET[x % ALPHABET.length];
  return s;
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isValidCode = (c) => new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(normalizeCode(c));
export const formatCode = (c) => (c ? `${c.slice(0, 5)} ${c.slice(5)}` : '');

/** Pull a pairing code out of a scanned QR (a Shelf link URL) or typed text. */
export function codeFromText(text) {
  const m = String(text || '').match(/#\/link\/([A-Za-z0-9]{6,16})/);
  const c = normalizeCode(m ? m[1] : text);
  return isValidCode(c) ? c : '';
}

export const pairingUrl = (code) => `${location.href.split('#')[0]}#/link/${code}`;

// ---------- crypto ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveSecrets(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('shelf-home-library-link-v2'), iterations: 150000, hash: 'SHA-256' }, base, 384));
  const topicId = [...bits.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic: `shelf-library/v2/${topicId}`, key };
}

async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open(key, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, key, u8.slice(12));
  return JSON.parse(dec.decode(plain));
}

// ---------- relays ----------
function relayUrls() {
  try {
    // Optional override (also used by the automated tests).
    const custom = JSON.parse(localStorage.getItem('shelf.relays') || 'null');
    if (Array.isArray(custom) && custom.length) return custom;
  } catch { /* ignore */ }
  return DEFAULT_RELAYS;
}

const myId = () => store.getSetting('deviceId');
const msgId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

async function publish(msg) {
  const s = session;
  if (!s) return;
  const payload = await seal(s.key, { ...msg, from: myId(), id: msgId(), role, name: deviceName() });
  for (const c of s.clients) if (c.connected) c.publish(s.topic, payload, { qos: 0 });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Send records in small encrypted chunks. */
async function sendRecords(recs, to) {
  let batch = {};
  let size = 0;
  const flush = async () => {
    if (!size) return;
    await publish({ t: 'records', d: batch, to });
    batch = {};
    size = 0;
    await pause(40); // be gentle with the free relays
  };
  for (const s of ['rooms', 'meta', 'books']) {
    for (const r of recs[s] || []) {
      const len = JSON.stringify(r).length;
      if (size && size + len > CHUNK_CHARS) await flush();
      (batch[s] ||= []).push(r);
      size += len;
    }
  }
  await flush();
}

async function handle(bytes) {
  const s = session;
  if (!s) return;
  let msg;
  try { msg = await open(s.key, bytes); } catch { return; } // not ours / tampered
  if (!msg || msg.from === myId() || seen.has(msg.id)) return;
  seen.set(msg.id, Date.now());
  if (msg.to && msg.to !== myId()) return;

  const isNew = !peers.has(msg.from);
  peers.set(msg.from, { name: String(msg.name || 'Device').slice(0, 40), role: msg.role, lastSeen: Date.now() });
  if (isNew) refreshState();

  if (msg.t === 'bye') {
    peers.delete(msg.from);
    refreshState();
  } else if (msg.t === 'hello') {
    // Someone joined: say hi back and swap manifests.
    if (!msg.reply) await publish({ t: 'hello', reply: true, to: msg.from });
    await publish({ t: 'manifest', m: store.manifest(), to: msg.from });
  } else if (msg.t === 'manifest') {
    await sendRecords(store.recordsNewerThan(msg.m), msg.from);
  } else if (msg.t === 'records') {
    await store.mergeRecords(msg.d, msg.from);
  }
}

async function ensureLib() {
  if (!window.mqtt) await loadScript('vendor/mqtt.min.js');
}

async function startSession(code) {
  await ensureLib();
  stopSession();
  const { topic, key } = await deriveSecrets(code);
  const s = (session = { code, topic, key, clients: [], everConnected: false });
  refreshState();
  for (const url of relayUrls()) {
    const client = window.mqtt.connect(url, {
      clientId: `shelf_${Math.random().toString(16).slice(2, 14)}`,
      keepalive: 30,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      clean: true,
      protocolVersion: 4,
    });
    client.on('connect', () => {
      if (session !== s) return client.end(true);
      s.everConnected = true;
      client.subscribe(topic, { qos: 0 }, () => {
        if (session === s) publish({ t: 'hello' });
      });
      refreshState();
    });
    client.on('message', (_t, payload) => { if (session === s) handle(payload); });
    client.on('close', () => { if (session === s) refreshState(); });
    client.on('error', (e) => console.warn('[link]', url, e?.message || e));
    s.clients.push(client);
  }
  s.heartbeat = setInterval(() => publish({ t: 'ping' }), HEARTBEAT);
  s.sweep = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of peers) if (now - p.lastSeen > PEER_TIMEOUT) { peers.delete(id); changed = true; }
    for (const [id, t] of seen) if (now - t > 10 * 60000) seen.delete(id);
    if (changed) refreshState();
  }, 10000);
}

function stopSession() {
  const s = session;
  session = null;
  peers.clear();
  if (!s) return;
  clearInterval(s.heartbeat);
  clearInterval(s.sweep);
  for (const c of s.clients) {
    try {
      if (c.connected) {
        // Best-effort goodbye on this relay, then close.
        seal(s.key, { t: 'bye', from: myId(), id: msgId() }).then((p) => c.publish(s.topic, p, {}, () => c.end(true))).catch(() => c.end(true));
      } else c.end(true);
    } catch { /* ignore */ }
  }
}

// Stream local changes to the other devices.
store.onChange(({ changes, origin }) => {
  if (!session || origin === 'remote') return;
  const recs = {};
  for (const { store: s, record } of changes) {
    if (s === 'meta' && record.local) continue;
    (recs[s] ||= []).push(record);
  }
  if (Object.keys(recs).length) sendRecords(recs);
});

export const peerNameOf = (id) => peers.get(id)?.name || '';

// ---------- public controls ----------
export async function startHosting({ newCode = false } = {}) {
  let code = store.getSetting('hostCode');
  if (!isValidCode(code || '') || newCode) {
    code = genCode();
    await store.setSetting('hostCode', code);
  }
  role = 'host';
  await store.setSetting('hosting', true);
  await store.setSetting('linkedHost', null);
  try { await startSession(code); } catch (e) { setState('error', e.message); }
}

export async function connectTo(code) {
  code = normalizeCode(code);
  if (!isValidCode(code)) { setState('error', 'That code doesn’t look right — it’s 10 letters and numbers.'); return; }
  role = 'guest';
  await store.setSetting('linkedHost', code);
  await store.setSetting('hosting', false);
  try { await startSession(code); } catch (e) { setState('error', e.message); }
}

export async function unlink() {
  stopSession();
  role = null;
  await store.setSetting('hosting', false);
  await store.setSetting('linkedHost', null);
  setState('off');
}

/** Resume whatever link was active last time the app was open. */
export function autoStart() {
  const guestCode = store.getSetting('linkedHost');
  if (store.getSetting('hosting')) startHosting();
  else if (guestCode && isValidCode(guestCode)) connectTo(guestCode);
  else if (guestCode) {
    // A code from the old linking system: ask to pair again.
    store.setSetting('linkedHost', null);
  }

  const kick = () => {
    if (!session) return;
    for (const c of session.clients) if (!c.connected) { try { c.reconnect(); } catch { /* ignore */ } }
    publish({ t: 'hello' });
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  window.addEventListener('online', kick);
  window.addEventListener('pagehide', () => { if (session) publish({ t: 'bye' }); });
}
