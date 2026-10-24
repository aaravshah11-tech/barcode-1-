// Tiny IndexedDB wrapper. Only core/store.js uses this.
//   records: every synced record, key "collection/id"
//   local:   device-only settings (theme, sync cursors, folder handles…)

const DB_NAME = 'homebase';
const DB_VERSION = 1;
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('This browser can’t store data offline (no IndexedDB).'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'k' }).createIndex('c', 'c');
      if (!db.objectStoreNames.contains('local')) db.createObjectStore('local', { keyPath: 'key' });
    };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other HomeBase tabs and reload.'));
  });
  return dbPromise;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });

export async function getAll(store) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}
export const put = (store, v) => putMany(store, [v]);

export async function del(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}
