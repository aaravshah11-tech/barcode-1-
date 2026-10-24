// ============================================================
// Generic synced store. Every tool keeps its data here as
// records in named collections ("books", "items", "matches"…).
//
// Each record: { id, ...fields, updatedAt, updatedBy, deleted? }
// Deletes leave a tombstone so they sync. Merging is
// "last write wins" (newer updatedAt; tie → larger updatedBy),
// the same rule the Supabase table enforces server-side.
//
// Sync adapters only use: onChange, mergeRecords, manifest,
// recordsNewerThan, allRaw.
// ============================================================
import * as db from './db.js';

const data = new Map(); // collection -> Map(id -> record)
const local = new Map(); // device-only settings
const listeners = new Set();
let deviceId = '';

export const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const col = (c) => { if (!data.has(c)) data.set(c, new Map()); return data.get(c); };
const keyOf = (c, id) => `${c}/${id}`;

export async function init() {
  const [recs, loc] = await Promise.all([db.getAll('records'), db.getAll('local')]);
  for (const r of recs) { const { k, c, ...rec } = r; col(c).set(rec.id, rec); }
  for (const l of loc) local.set(l.key, l.value);
  deviceId = getLocal('deviceId');
  if (!deviceId) { deviceId = uid(); await setLocal('deviceId', deviceId); }
}
export const getDeviceId = () => deviceId;

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(changes, origin, source) {
  if (!changes.length) return;
  for (const fn of listeners) { try { fn({ changes, origin, source }); } catch (e) { console.error(e); } }
}
const toRow = (c, rec) => ({ ...rec, k: keyOf(c, rec.id), c });
const stamp = (rec, prev) => ({ ...rec, updatedAt: Math.max(Date.now(), (prev || 0) + 1), updatedBy: deviceId });

// ---------- reading ----------
export const all = (c) => [...col(c).values()].filter((r) => !r.deleted);
export const get = (c, id) => { const r = col(c).get(id); return r && !r.deleted ? r : null; };
export const where = (c, fn) => all(c).filter(fn);
export const collections = () => [...data.keys()];
export const allRaw = (c) => [...col(c).values()];
export const getRaw = (c, id) => col(c).get(id) || null;

// ---------- writing ----------
export async function put(c, input) {
  const prev = input.id ? col(c).get(input.id) : null;
  const base = prev && !prev.deleted ? prev : {};
  const rec = stamp({ ...base, ...input, id: input.id || uid(), deleted: false, createdAt: base.createdAt || input.createdAt || Date.now() }, prev?.updatedAt);
  col(c).set(rec.id, rec);
  await db.put('records', toRow(c, rec));
  emit([{ c, record: rec, prev }], 'local');
  return rec;
}

/** Write many records in one go (one change event). */
export async function putMany(c, inputs) {
  const changes = [];
  const rows = [];
  for (const input of inputs) {
    const prev = input.id ? col(c).get(input.id) : null;
    const base = prev && !prev.deleted ? prev : {};
    const rec = stamp({ ...base, ...input, id: input.id || uid(), deleted: false, createdAt: base.createdAt || input.createdAt || Date.now() }, prev?.updatedAt);
    col(c).set(rec.id, rec);
    rows.push(toRow(c, rec));
    changes.push({ c, record: rec, prev });
  }
  await db.putMany('records', rows);
  emit(changes, 'local');
  return changes.map((x) => x.record);
}

export async function patch(c, id, changes) {
  const r = get(c, id);
  return r ? put(c, { ...r, ...changes }) : null;
}

export async function remove(c, id) {
  const prev = col(c).get(id);
  if (!prev || prev.deleted) return null;
  const rec = stamp({ id, deleted: true }, prev.updatedAt);
  col(c).set(id, rec);
  await db.put('records', toRow(c, rec));
  emit([{ c, record: rec, prev }], 'local');
  return prev;
}

/** Undo a remove(). */
export const restore = (c, prev) => put(c, { ...prev });

// ---------- shared settings (synced) & local settings (this device only) ----------
export const setting = (key, fallback = null) => get('settings', key)?.value ?? fallback;
export const setSetting = (key, value) => put('settings', { id: key, value });
export const getLocal = (key, fallback = null) => (local.has(key) ? local.get(key) : fallback);
export async function setLocal(key, value) {
  local.set(key, value);
  await db.put('local', { key, value });
  emit([{ c: '_local', record: { id: key, value } }], 'local');
}

// ---------- sync support ----------
/** { collection: { id: updatedAt } } for everything, tombstones included. */
export function manifest() {
  const out = {};
  for (const [c, m] of data) { out[c] = {}; for (const r of m.values()) out[c][r.id] = r.updatedAt || 0; }
  return out;
}

export function recordsNewerThan(remote = {}) {
  const out = {};
  for (const [c, m] of data) {
    const theirs = remote[c] || {};
    const list = [...m.values()].filter((r) => (r.updatedAt || 0) > (theirs[r.id] ?? -1));
    if (list.length) out[c] = list;
  }
  return out;
}

export function wins(a, b) {
  if (!b) return true;
  const ta = a.updatedAt || 0, tb = b.updatedAt || 0;
  return ta > tb || (ta === tb && String(a.updatedBy || '') > String(b.updatedBy || ''));
}

/** Merge records from another device or the cloud. Returns how many changed. */
export async function mergeRecords(byCollection, source = 'remote', origin = 'remote') {
  const changes = [];
  const rows = [];
  for (const [c, list] of Object.entries(byCollection || {})) {
    if (!Array.isArray(list) || c.startsWith('_')) continue;
    for (const rec of list) {
      if (!rec || typeof rec !== 'object' || !rec.id) continue;
      const prev = col(c).get(rec.id);
      if (!wins(rec, prev)) continue;
      col(c).set(rec.id, rec);
      rows.push(toRow(c, rec));
      changes.push({ c, record: rec, prev });
    }
  }
  await db.putMany('records', rows);
  emit(changes, origin, source);
  return changes.length;
}

/** Everything (no tombstones) for a JSON backup. */
export function exportAll() {
  const out = {};
  for (const c of data.keys()) { const list = all(c); if (list.length) out[c] = list; }
  return out;
}

/** Restore a backup. Missing/deleted records come back with a fresh timestamp so they sync too. */
export async function importAll(byCollection) {
  const now = Date.now();
  const fixed = {};
  for (const [c, list] of Object.entries(byCollection || {})) {
    if (!Array.isArray(list) || c.startsWith('_')) continue;
    fixed[c] = list.filter((r) => r && r.id).map((r) => {
      const cur = col(c).get(r.id);
      return !cur || cur.deleted ? { ...r, deleted: false, updatedAt: now, updatedBy: deviceId } : r;
    });
  }
  // origin 'local' so the restored data is also sent to linked devices / the cloud.
  return mergeRecords(fixed, 'import', 'local');
}

/** Delete everything in some collections (as tombstones so linked devices follow). */
export async function eraseCollections(cols) {
  const changes = [];
  const rows = [];
  for (const c of cols) {
    for (const r of col(c).values()) {
      if (r.deleted) continue;
      const t = stamp({ id: r.id, deleted: true }, r.updatedAt);
      col(c).set(r.id, t);
      rows.push(toRow(c, t));
      changes.push({ c, record: t, prev: r });
    }
  }
  await db.putMany('records', rows);
  emit(changes, 'local');
}
