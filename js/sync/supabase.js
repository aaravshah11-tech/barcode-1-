// ============================================================
// Cloud sync with Supabase (free tier): database + realtime.
//
// • Each device signs in anonymously (no email needed).
// • Devices share a "household". The computer creates it; the
//   phone joins by scanning a QR code that carries the household
//   id and a secret join code. Row-level security means only
//   household members can read or write its rows.
// • All tool data lives in one table `records` (one row per
//   record, JSON in `data`). Newest write wins, enforced by a
//   trigger, and the same rule is used locally.
// • Local changes queue in an outbox (kept on the device), so
//   offline edits upload once you're back online.
// • Live updates arrive through Supabase Realtime; a "seq"
//   cursor lets a device catch up on everything it missed.
// ============================================================
import * as store from '../core/store.js';
import { loadScript } from '../core/ui.js';

const CFG = 'sb.config';      // { url, key, householdId, joinCode, role, name }
const CURSOR = 'sb.cursor';   // last seq pulled
const OUTBOX = 'sb.outbox';   // ["collection/id", …] waiting to upload
const BATCH = 200;

let client = null;
let channel = null;
let state = 'off';
let message = '';
let devices = [];
let outbox = new Set();
let flushTimer = null;
let pullTimer = null;
let started = false;
const subs = new Set();

export const config = () => store.getLocal(CFG);
export const isConfigured = () => !!config()?.householdId;
export const getState = () => ({ mode: 'cloud', state, message, devices, pending: outbox.size, householdId: config()?.householdId || '' });
export function onState(fn) { subs.add(fn); return () => subs.delete(fn); }
function setState(s, msg = '') { state = s; message = msg; const snap = getState(); subs.forEach((f) => { try { f(snap); } catch (e) { console.error(e); } }); }

export const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Computer';
};

/** Turn Supabase errors into plain English. */
export function friendlyError(e) {
  const msg = String(e?.message || e || '');
  const code = e?.code || '';
  if (/anonymous.*disabled|anonymous_provider_disabled/i.test(msg + code)) return 'Anonymous sign-ins are turned off. In Supabase: Authentication › Sign In / Providers › turn on “Allow anonymous sign-ins”.';
  if (/create_household|join_household|function .* does not exist|relation .* does not exist|PGRST202|42883|42P01/i.test(msg + code)) return 'The database isn’t set up yet. In Supabase open SQL Editor, paste supabase/schema.sql and press Run.';
  if (/Pairing code not valid/i.test(msg)) return 'That pairing code isn’t valid any more. Show a fresh QR code on the computer and scan again.';
  if (/Invalid API key|No API key|apikey/i.test(msg)) return 'The Supabase key looks wrong. Copy the “anon public” key again from Project Settings › API.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return navigator.onLine === false ? 'You’re offline. Changes are saved here and will upload when you’re back online.' : 'Can’t reach Supabase. Check the Project URL and your internet connection.';
  return msg || 'Something went wrong talking to Supabase.';
}

async function makeClient(url, key) {
  if (!window.supabase) await loadScript('vendor/supabase.js');
  return window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'homebase-auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

async function ensureSession(c) {
  const { data } = await c.auth.getSession();
  if (data?.session) return data.session;
  const { data: d2, error } = await c.auth.signInAnonymously();
  if (error) throw error;
  return d2.session;
}

const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');

// ---------- setup & pairing ----------
/** Computer: connect to a Supabase project and create the household. */
export async function setupHousehold(url, key, name = 'Home') {
  url = normUrl(url);
  key = String(key || '').trim();
  if (!/^https:\/\/.+\.supabase\.co$/.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error('The Project URL should look like https://abcdefgh.supabase.co');
  const c = await makeClient(url, key);
  await ensureSession(c);
  const { data, error } = await c.rpc('create_household', { p_name: name, p_device: deviceName() });
  if (error) throw error;
  await store.setLocal(CFG, { url, key, householdId: data.id, joinCode: data.join_code, role: 'host', name });
  await store.setLocal(CURSOR, 0);
  await queueEverything();
  client = c;
  await start();
}

/** Phone: join using the details from the computer's QR code. */
export async function joinHousehold({ url, key, householdId, joinCode }) {
  const c = await makeClient(normUrl(url), key);
  await ensureSession(c);
  const { error } = await c.rpc('join_household', { p_household: householdId, p_code: joinCode, p_device: deviceName() });
  if (error) throw error;
  await store.setLocal(CFG, { url: normUrl(url), key, householdId, joinCode, role: 'guest' });
  await store.setLocal(CURSOR, 0);
  await queueEverything();
  client = c;
  await start();
}

/** Make a new join code (old QR codes stop working). */
export async function newJoinCode() {
  const cfg = config();
  const { data, error } = await client.rpc('rotate_join_code', { p_household: cfg.householdId });
  if (error) throw error;
  await store.setLocal(CFG, { ...cfg, joinCode: data });
  return data;
}

/** Stop syncing on this device (data stays here and in the cloud). */
export async function disconnect() {
  await stop();
  try { await client?.auth.signOut(); } catch { /* ignore */ }
  client = null;
  await store.setLocal(CFG, null);
  await store.setLocal(OUTBOX, []);
  outbox.clear();
  setState('off');
}

// ---------- outbox / push ----------
async function queueEverything() {
  for (const c of store.collections()) for (const r of store.allRaw(c)) outbox.add(`${c}/${r.id}`);
  await saveOutbox();
}
const saveOutbox = () => store.setLocal(OUTBOX, [...outbox]);

function scheduleFlush(ms = 250) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

async function flush() {
  if (!client || !outbox.size || state === 'off') return;
  if (navigator.onLine === false) return setState('offline', 'You’re offline. Changes will upload when you’re back online.');
  const cfg = config();
  const keys = [...outbox].slice(0, BATCH);
  const rows = [];
  for (const k of keys) {
    const i = k.indexOf('/');
    const c = k.slice(0, i), id = k.slice(i + 1);
    const rec = store.getRaw(c, id);
    if (!rec) continue;
    rows.push({ household_id: cfg.householdId, collection: c, id, data: rec, updated_at: rec.updatedAt || 0, updated_by: rec.updatedBy || '', deleted: !!rec.deleted });
  }
  try {
    if (rows.length) {
      const { error } = await client.from('records').upsert(rows, { onConflict: 'household_id,collection,id', returning: 'minimal' });
      if (error) throw error;
    }
    keys.forEach((k) => outbox.delete(k));
    await saveOutbox();
    if (state !== 'connected') setState('connected');
    else setState('connected'); // refresh pending count
    if (outbox.size) scheduleFlush(50);
  } catch (e) {
    console.warn('[sync] upload failed', e);
    setState('error', friendlyError(e));
    scheduleFlush(10000);
  }
}

// ---------- pull ----------
async function pull() {
  if (!client) return;
  const cfg = config();
  let cursor = store.getLocal(CURSOR, 0);
  for (;;) {
    const { data, error } = await client.from('records').select('collection,id,data,seq').eq('household_id', cfg.householdId).gt('seq', cursor).order('seq', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    const by = {};
    for (const row of data) (by[row.collection] ||= []).push(row.data);
    await store.mergeRecords(by, 'cloud');
    cursor = data[data.length - 1].seq;
    await store.setLocal(CURSOR, cursor);
    if (data.length < 1000) break;
  }
}

// ---------- realtime ----------
function subscribe() {
  const cfg = config();
  channel?.unsubscribe();
  channel = client.channel(`household-${cfg.householdId}`, { config: { presence: { key: store.getDeviceId() } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `household_id=eq.${cfg.householdId}` }, async (payload) => {
      const row = payload.new;
      if (!row?.data) return;
      await store.mergeRecords({ [row.collection]: [row.data] }, 'cloud:' + (row.updated_by || ''));
      if (row.seq > store.getLocal(CURSOR, 0)) await store.setLocal(CURSOR, row.seq);
    })
    .on('presence', { event: 'sync' }, () => {
      const st = channel.presenceState();
      devices = Object.entries(st).filter(([k]) => k !== store.getDeviceId()).map(([, v]) => v[0]?.name || 'Device');
      setState(state, message);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ name: deviceName(), at: Date.now() });
        setState('connected');
        resync();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setState('error', navigator.onLine === false ? 'You’re offline. Changes are saved here.' : 'Live updates interrupted. Reconnecting…');
      }
    });
}

let resyncing = null;
function resync() {
  if (resyncing) return resyncing;
  resyncing = (async () => {
    try { await pull(); await flush(); } catch (e) { setState('error', friendlyError(e)); } finally { resyncing = null; }
  })();
  return resyncing;
}

// ---------- lifecycle ----------
export async function start() {
  const cfg = config();
  if (!cfg?.householdId) return;
  outbox = new Set(store.getLocal(OUTBOX, []));
  setState('connecting', 'Connecting to Supabase…');
  try {
    client ||= await makeClient(cfg.url, cfg.key);
    await ensureSession(client);
  } catch (e) {
    setState('error', friendlyError(e));
    setTimeout(() => { if (config()) start(); }, 15000);
    return;
  }
  subscribe();
  resync();
  if (!started) {
    started = true;
    store.onChange(({ changes, origin }) => {
      if (!config() || origin === 'remote') return;
      const keys = changes.filter(({ c }) => !c.startsWith('_')).map(({ c, record }) => `${c}/${record.id}`);
      if (!keys.length) return; // ignore device-only settings (incl. saving the outbox itself)
      keys.forEach((k) => outbox.add(k));
      saveOutbox();
      scheduleFlush();
    });
    window.addEventListener('online', () => { if (config()) { setState('connecting'); subscribe(); resync(); } });
    window.addEventListener('offline', () => { if (config()) setState('offline', 'You’re offline. Changes are saved here and upload later.'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && config()) resync(); });
    clearInterval(pullTimer);
    pullTimer = setInterval(() => { if (config()) resync(); }, 60000);
  }
}

export async function stop() {
  clearTimeout(flushTimer);
  try { await channel?.unsubscribe(); } catch { /* ignore */ }
  channel = null;
  setState('off');
}

/** Pairing data shown in the computer's QR code. */
export function pairingPayload() {
  const c = config();
  return c ? { t: 'sb', u: c.url, k: c.key, h: c.householdId, j: c.joinCode } : null;
}
