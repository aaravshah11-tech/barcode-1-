// One-time import of data from the old "Shelf" app (same website, older database).
import * as store from './store.js';

function openIfExists(name) {
  return new Promise((resolve) => {
    let created = false;
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => { created = true; req.transaction.abort(); };
    req.onsuccess = () => resolve(created ? null : req.result);
    req.onerror = () => resolve(null);
  });
}

const readAll = (db, s) => new Promise((resolve) => {
  if (!db.objectStoreNames.contains(s)) return resolve([]);
  const r = db.transaction(s).objectStore(s).getAll();
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => resolve([]);
});

export async function migrateFromShelf() {
  if (store.getLocal('migratedShelf')) return 0;
  const db = await openIfExists('shelf');
  if (!db) { await store.setLocal('migratedShelf', true); return 0; }
  const [books, rooms, meta] = await Promise.all([readAll(db, 'books'), readAll(db, 'rooms'), readAll(db, 'meta')]);
  db.close();
  const m = Object.fromEntries(meta.map((x) => [x.key, x.value]));

  // Rooms: bookcases with N shelves -> areas with spots "Shelf 1..N" (stable ids so both devices match).
  const newRooms = rooms.map((r) => r.deleted ? { id: r.id, deleted: true, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : {
    id: r.id, name: r.name, order: r.order, updatedAt: r.updatedAt, updatedBy: r.updatedBy,
    areas: (r.cases || []).map((c) => ({ id: c.id, name: c.name, kind: 'bookcase', spots: Array.from({ length: c.shelves || 0 }, (_, i) => ({ id: `${c.id}-s${i + 1}`, name: `Shelf ${i + 1}` })) })),
  });
  // Books: {roomId, caseId, shelf} -> {roomId, areaId, spotId}
  const newBooks = books.map((b) => {
    if (b.deleted) return b;
    const { location: l, ...rest } = b;
    const loc = l?.roomId ? { roomId: l.roomId, areaId: l.caseId || '', spotId: l.caseId && /^\d+$/.test(String(l.shelf || '')) ? `${l.caseId}-s${l.shelf}` : '' } : null;
    return { ...rest, location: loc, createdAt: b.addedAt || b.createdAt };
  });
  await store.mergeRecords({ rooms: newRooms, books: newBooks }, 'shelf', 'local');
  if (Array.isArray(m.owners) && m.owners.length) await store.setSetting('family', [...new Set([...store.setting('family', []), ...m.owners])]);

  // Keep the existing phone <-> computer quick link working.
  if (m.hosting && m.hostCode) { await store.setLocal('relay.hostCode', m.hostCode); await store.setLocal('relay.hosting', true); }
  else if (m.linkedHost) await store.setLocal('relay.linkedHost', m.linkedHost);
  if (m.lastLocation?.roomId) await store.setLocal('library.lastLocation', { roomId: m.lastLocation.roomId, areaId: m.lastLocation.caseId || '', spotId: m.lastLocation.caseId && m.lastLocation.shelf ? `${m.lastLocation.caseId}-s${m.lastLocation.shelf}` : '' });
  await store.setLocal('seededRooms', true);
  await store.setLocal('migratedShelf', true);
  return newBooks.length;
}
