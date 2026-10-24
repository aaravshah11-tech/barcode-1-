// ============================================================
// Data layer. The ONLY module that reads/writes the database.
//
// Everything else (views, device link, a future Supabase sync)
// talks to this API. Every synced record carries `updatedAt` +
// `updatedBy`, and deletes leave a tombstone ({deleted:true}),
// so any sync adapter can merge with "last write wins" using
// manifest() / recordsNewerThan() / mergeRecords().
// ============================================================
import * as db from './db.js';

const books = new Map();
const rooms = new Map();
const meta = new Map();
const maps = { books, rooms, meta };
const listeners = new Set();

/** Settings that are shared between linked devices. Everything else stays on this device. */
const SHARED_META = new Set(['owners']);

let deviceId = '';

export const uid = () =>
  globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const STATUSES = [
  { id: 'unread', label: 'Unread' },
  { id: 'reading', label: 'Reading' },
  { id: 'read', label: 'Read' },
];

const BOOK_DEFAULTS = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: [], publisher: '', year: '', pages: 0,
  subjects: [], description: '', language: '', cover: '', source: 'manual',
  location: null, owner: '', status: 'unread', rating: 0, notes: '', favourite: false,
  lentTo: '', lentDate: '', needsLookup: false, incomplete: false,
};

// ---------- lifecycle ----------
export async function init() {
  const [b, r, m] = await Promise.all([db.getAll('books'), db.getAll('rooms'), db.getAll('meta')]);
  b.forEach((x) => books.set(x.id, x));
  r.forEach((x) => rooms.set(x.id, x));
  m.forEach((x) => meta.set(x.key, x));
  deviceId = getSetting('deviceId');
  if (!deviceId) {
    deviceId = uid();
    await setSetting('deviceId', deviceId);
  }
  if (!getSetting('seeded')) {
    // Fixed ids so two devices that both seed don't end up with duplicate rooms after linking.
    if (!rooms.size) {
      await saveRoom({ id: 'seed-living', name: 'Living room', order: 1, cases: [{ id: 'seed-living-1', name: 'Bookcase', shelves: 5 }] }, { stampTime: 1 });
    }
    await setSetting('seeded', true);
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(changes, origin, source) {
  if (!changes.length) return;
  for (const fn of listeners) {
    try { fn({ changes, origin, source }); } catch (e) { console.error(e); }
  }
}

function stamp(rec, prevUpdatedAt = 0) {
  return { ...rec, updatedAt: Math.max(Date.now(), (prevUpdatedAt || 0) + 1), updatedBy: deviceId };
}

// ---------- books ----------
export const allBooks = () => [...books.values()].filter((b) => !b.deleted);
export const getBook = (id) => {
  const b = books.get(id);
  return b && !b.deleted ? b : null;
};
export const findByIsbn = (isbn13) => (isbn13 ? allBooks().filter((b) => b.isbn13 === isbn13) : []);

export async function saveBook(input) {
  const prev = input.id ? books.get(input.id) : null;
  const base = prev && !prev.deleted ? prev : {};
  const rec = stamp(
    { ...BOOK_DEFAULTS, ...base, ...input, id: input.id || uid(), deleted: false, addedAt: base.addedAt || input.addedAt || Date.now() },
    prev?.updatedAt,
  );
  books.set(rec.id, rec);
  await db.put('books', rec);
  emit([{ store: 'books', record: rec, prev }], 'local');
  return rec;
}

export async function updateBook(id, patch) {
  const b = getBook(id);
  if (!b) return null;
  return saveBook({ ...b, ...patch });
}

export async function deleteBook(id) {
  const prev = books.get(id);
  if (!prev) return;
  const rec = stamp({ id, deleted: true }, prev.updatedAt);
  books.set(id, rec);
  await db.put('books', rec);
  emit([{ store: 'books', record: rec, prev }], 'local');
  return prev;
}

/** Restore a book removed with deleteBook (for "Undo"). */
export async function restoreBook(prev) {
  const cur = books.get(prev.id);
  return saveBook({ ...prev, updatedAt: cur?.updatedAt || prev.updatedAt });
}

// ---------- rooms & bookcases ----------
export const allRooms = () =>
  [...rooms.values()].filter((r) => !r.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
export const getRoom = (id) => {
  const r = rooms.get(id);
  return r && !r.deleted ? r : null;
};
export const getCase = (roomId, caseId) => getRoom(roomId)?.cases?.find((c) => c.id === caseId) || null;

export async function saveRoom(room, { stampTime } = {}) {
  const prev = rooms.get(room.id);
  let rec = stamp({ cases: [], ...room, deleted: false }, prev?.updatedAt);
  if (stampTime) rec = { ...rec, updatedAt: stampTime, updatedBy: 'seed' };
  rooms.set(rec.id, rec);
  await db.put('rooms', rec);
  emit([{ store: 'rooms', record: rec, prev }], 'local');
  return rec;
}

export const addRoom = (name) => saveRoom({ id: uid(), name: name.trim(), cases: [], order: Date.now() });
export async function renameRoom(id, name) {
  const r = getRoom(id);
  if (r) return saveRoom({ ...r, name: name.trim() });
}

async function clearLocations(match) {
  for (const b of allBooks().filter((b) => b.location && match(b.location))) {
    await saveBook({ ...b, location: null });
  }
}

export async function deleteRoom(id) {
  const prev = rooms.get(id);
  if (!prev) return;
  await clearLocations((l) => l.roomId === id);
  const rec = stamp({ id, deleted: true }, prev.updatedAt);
  rooms.set(id, rec);
  await db.put('rooms', rec);
  emit([{ store: 'rooms', record: rec, prev }], 'local');
}

export async function addCase(roomId, name, shelves = 5) {
  const r = getRoom(roomId);
  if (!r) return null;
  const c = { id: uid(), name: name.trim(), shelves };
  await saveRoom({ ...r, cases: [...(r.cases || []), c] });
  return c;
}

export async function updateCase(roomId, caseId, patch) {
  const r = getRoom(roomId);
  if (!r) return;
  await saveRoom({ ...r, cases: r.cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c)) });
}

export async function deleteCase(roomId, caseId) {
  const r = getRoom(roomId);
  if (!r) return;
  await clearLocations((l) => l.roomId === roomId && l.caseId === caseId);
  await saveRoom({ ...r, cases: r.cases.filter((c) => c.id !== caseId) });
}

export function countBooksAt(match) {
  return allBooks().filter((b) => b.location && match(b.location)).length;
}

export function shelfLabel(shelf) {
  if (shelf === '' || shelf == null) return '';
  return /^\d+$/.test(String(shelf)) ? `Shelf ${shelf}` : String(shelf);
}

/** { room, bookcase, shelf } display names for a location (empty strings when unset). */
export function locationParts(loc) {
  const room = loc?.roomId ? getRoom(loc.roomId) : null;
  const bc = room && loc.caseId ? room.cases.find((c) => c.id === loc.caseId) : null;
  return { room: room?.name || '', bookcase: bc?.name || '', shelf: room ? shelfLabel(loc.shelf) : '' };
}

export function locationLabel(loc) {
  const p = locationParts(loc);
  const parts = [p.room, p.bookcase, p.shelf].filter(Boolean);
  return parts.length ? parts.join(' › ') : 'No location set';
}

// ---------- settings ----------
export function getSetting(key, fallback = null) {
  const m = meta.get(key);
  return m === undefined || m.deleted || m.value === undefined ? fallback : m.value;
}

export async function setSetting(key, value) {
  const shared = SHARED_META.has(key);
  const prev = meta.get(key);
  const rec = shared ? stamp({ key, value }, prev?.updatedAt) : { key, value, local: true };
  meta.set(key, rec);
  await db.put('meta', rec);
  emit([{ store: 'meta', record: rec, prev }], 'local');
}

export const owners = () => getSetting('owners', []);
export async function addOwner(name) {
  name = name.trim();
  if (!name || owners().includes(name)) return;
  await setSetting('owners', [...owners(), name]);
}
export async function removeOwner(name) {
  await setSetting('owners', owners().filter((o) => o !== name));
}

// ---------- sync support ----------
const isShared = (store, rec) => store !== 'meta' || SHARED_META.has(rec.key);
const keyOf = (store, rec) => (store === 'meta' ? rec.key : rec.id);

/** { books: {id: updatedAt}, rooms: {...}, meta: {...} } for every synced record, tombstones included. */
export function manifest() {
  const out = {};
  for (const [store, map] of Object.entries(maps)) {
    out[store] = {};
    for (const rec of map.values()) if (isShared(store, rec)) out[store][keyOf(store, rec)] = rec.updatedAt || 0;
  }
  return out;
}

/** Records we have that the other side is missing or holds an older copy of. */
export function recordsNewerThan(remote = {}) {
  const out = {};
  for (const [store, map] of Object.entries(maps)) {
    const theirs = remote[store] || {};
    out[store] = [...map.values()].filter((rec) => isShared(store, rec) && (rec.updatedAt || 0) > (theirs[keyOf(store, rec)] ?? -1));
  }
  return out;
}

function wins(a, b) {
  if (!b) return true;
  const ta = a.updatedAt || 0, tb = b.updatedAt || 0;
  return ta > tb || (ta === tb && String(a.updatedBy || '') > String(b.updatedBy || ''));
}

/**
 * Merge records that came from another device (last write wins).
 * `source` identifies the sender so it is not echoed back.
 */
export async function mergeRecords(data, source = 'remote') {
  const changes = [];
  for (const store of ['rooms', 'meta', 'books']) {
    const incoming = data?.[store];
    if (!Array.isArray(incoming)) continue;
    const map = maps[store];
    const toWrite = [];
    for (const rec of incoming) {
      if (!rec || typeof rec !== 'object' || !keyOf(store, rec) || !isShared(store, rec)) continue;
      const prev = map.get(keyOf(store, rec));
      if (!wins(rec, prev)) continue;
      map.set(keyOf(store, rec), rec);
      toWrite.push(rec);
      changes.push({ store, record: rec, prev });
    }
    await db.putMany(store, toWrite);
  }
  emit(changes, 'remote', source);
  return changes.length;
}

/**
 * Import a backup. Records we don't have (or deleted) are restored with a fresh
 * timestamp so they also reach linked devices; otherwise the newer copy wins.
 */
export async function importRecords(data) {
  const now = Date.now();
  const fix = (store, list) =>
    (list || []).filter((r) => r && keyOf(store, r)).map((r) => {
      const cur = maps[store].get(keyOf(store, r));
      if (!cur || cur.deleted) return { ...r, deleted: false, updatedAt: now, updatedBy: deviceId };
      return r;
    });
  const books = fix('books', data.books).map((b) => ({ ...BOOK_DEFAULTS, ...b }));
  const rooms = fix('rooms', data.rooms);
  const n = await mergeRecords({ books, rooms }, 'import');
  if (Array.isArray(data.owners)) for (const o of data.owners) await addOwner(String(o));
  return n;
}

/** Delete everything (as tombstones, so linked devices delete it too). */
export async function eraseAll() {
  const changes = [];
  for (const store of ['books', 'rooms']) {
    const toWrite = [];
    for (const rec of maps[store].values()) {
      if (rec.deleted) continue;
      const t = stamp({ id: rec.id, deleted: true }, rec.updatedAt);
      maps[store].set(rec.id, t);
      toWrite.push(t);
      changes.push({ store, record: t, prev: rec });
    }
    await db.putMany(store, toWrite);
  }
  emit(changes, 'local');
}
