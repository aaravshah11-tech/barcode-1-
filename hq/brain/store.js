// HQ's memory, kept in THIS browser on THIS computer (nothing is uploaded anywhere):
//   - small things (settings, Agents, codes) in localStorage
//   - the Mission Log in IndexedDB (it can grow to thousands of entries)
// Nothing here ever stores images, video or audio — only events like "motion detected".

const META = 'sentinel.hq.v1';
const DB = 'sentinel-hq';

function idb() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 3);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); // floor-plan pictures, 3D scans
        if (!d.objectStoreNames.contains('audit')) d.createObjectStore('audit', { keyPath: 'seq' }); // the audit trail (append-only)
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
const all = (db, store = 'events') => new Promise((resolve) => {
  const r = db.transaction(store).objectStore(store).getAll();
  r.onsuccess = () => resolve(r.result || []);
  r.onerror = () => resolve([]);
});

/**
 * Opens the store. `memory: true` keeps everything in memory only (used by the tests).
 * Returns the same functions the old SQLite database had, so HQ's logic didn't need to change.
 */
export async function openStore({ memory = false, storage = globalThis.localStorage } = {}) {
  const blank = { settings: {}, agents: [], pairCodes: [], viewers: [], nextEventId: 1, docs: {}, counters: {} };
  let meta = blank;
  if (!memory) { try { meta = { ...blank, ...JSON.parse(storage.getItem(META) || '{}') }; } catch { meta = blank; } }
  const db = memory ? null : await idb();
  let events = db ? (await all(db)).sort((a, b) => a.id - b.id) : [];
  let audit = db ? (await all(db, 'audit')).sort((a, b) => a.seq - b.seq) : [];
  const persistent = !!db || memory;
  const memFiles = new Map();

  const saveMeta = () => { if (!memory) try { storage.setItem(META, JSON.stringify(meta)); } catch { /* storage full or blocked */ } };
  const put = (ev) => { if (db) try { db.transaction('events', 'readwrite').objectStore('events').put(ev); } catch { /* ignore */ } };
  const del = (ids) => {
    if (!db || !ids.length) return;
    try { const st = db.transaction('events', 'readwrite').objectStore('events'); ids.forEach((id) => st.delete(id)); } catch { /* ignore */ }
  };
  const copy = (x) => (x == null ? null : structuredClone(x)); // keeps false, 0 and ''
  const live = () => meta.agents.filter((a) => !a.revoked);

  const api = {
    persistent,
    close() { try { db?.close(); } catch { /* ignore */ } },

    // ---------- settings ----------
    getSetting: (key, fallback = null) => (key in meta.settings ? copy(meta.settings[key]) : fallback),
    setSetting(key, value) { meta.settings[key] = copy(value); saveMeta(); return value; },

    // ---------- Agents ----------
    agents: () => live().sort((a, b) => a.number - b.number).map(copy),
    agent: (id) => copy(live().find((a) => a.id === id)),
    agentByTokenHash: (h) => copy(live().find((a) => a.tokenHash === h)),
    nextAgentNumber: () => Math.max(0, ...meta.agents.map((a) => a.number)) + 1,
    addAgent(a) {
      meta.agents.push({ name: '', mission: 'standby', settings: {}, lastSeen: null, battery: null, charging: null, ua: '', revoked: false, ...copy(a) });
      saveMeta();
      return api.agent(a.id);
    },
    updateAgent(id, patch) {
      const a = meta.agents.find((x) => x.id === id);
      if (a) { for (const k of ['codename', 'name', 'mission', 'settings', 'lastSeen', 'battery', 'charging', 'ua', 'place', 'nightArmed', 'battAlert', 'lastTamper', 'missionLog', 'notes', 'calibratedAt']) if (k in patch) a[k] = copy(patch[k]); saveMeta(); }
      return api.agent(id);
    },
    revokeAgent(id) { const a = meta.agents.find((x) => x.id === id); if (a) { a.revoked = true; a.tokenHash = `revoked:${Date.now()}`; saveMeta(); } },

    // ---------- one-time codes (role: 'agent' or 'viewer') ----------
    addPairCode(codeHash, expiresAt, role = 'agent') { meta.pairCodes.push({ codeHash, expiresAt, role, used: false }); saveMeta(); },
    /** Marks the code used. Returns its role the first time (before it expires), otherwise null. */
    usePairCode(codeHash, now = Date.now()) {
      const c = meta.pairCodes.find((x) => x.codeHash === codeHash && !x.used && x.expiresAt > now);
      if (!c) return null;
      c.used = true; saveMeta();
      return c.role;
    },
    prunePairCodes(now = Date.now()) { meta.pairCodes = meta.pairCodes.filter((c) => !c.used && c.expiresAt > now - 3600000); saveMeta(); },

    // ---------- linked phones that can view HQ from anywhere ----------
    viewers: () => meta.viewers.map(copy),
    addViewer(v) { meta.viewers.push(copy(v)); saveMeta(); return copy(v); },
    viewerByTokenHash: (h) => copy(meta.viewers.find((v) => v.tokenHash === h)),
    updateViewer(id, patch) { const v = meta.viewers.find((x) => x.id === id); if (v) { Object.assign(v, copy(patch)); saveMeta(); } },
    removeViewer(id) { meta.viewers = meta.viewers.filter((v) => v.id !== id); saveMeta(); },

    // ---------- records: alerts, incidents, rules… (small lists kept with the settings) ----------
    docs: (name) => (meta.docs[name] || []).map(copy),
    doc: (name, id) => copy((meta.docs[name] || []).find((d) => d.id === id)),
    putDoc(name, d, max = 5000) {
      const list = (meta.docs[name] ||= []);
      const i = list.findIndex((x) => x.id === d.id);
      if (i >= 0) list[i] = copy(d); else { list.push(copy(d)); if (list.length > max) list.splice(0, list.length - max); }
      saveMeta();
      return copy(d);
    },
    removeDocs(name, pred) { const before = (meta.docs[name] || []).length; meta.docs[name] = (meta.docs[name] || []).filter((d) => !pred(d)); saveMeta(); return before - meta.docs[name].length; },
    /** Next number in a named sequence (e.g. incidents in 2026). */
    nextNumber(key) { meta.counters[key] = (meta.counters[key] || 0) + 1; saveMeta(); return meta.counters[key]; },

    // ---------- Mission Log ----------
    addEvent(e) {
      const ev = { id: meta.nextEventId++, ts: e.ts || Date.now(), agentId: e.agentId || null, kind: e.kind, level: e.level || 'info', message: e.message, data: e.data ?? null };
      saveMeta();
      events.push(ev);
      put(ev);
      return copy(ev);
    },
    events({ limit = 200, before = null, since = null, kind = null } = {}) {
      const out = [];
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i];
        if (before && e.id >= before) continue;
        if (since && e.ts < since) break;
        if (kind && e.kind !== kind) continue;
        out.push(copy(e));
      }
      return out;
    },
    allEvents: () => events.map(copy),
    /** Auto-delete old Mission Log entries. Returns how many were removed. */
    pruneEvents(olderThanMs, now = Date.now()) {
      const cut = now - olderThanMs;
      const gone = events.filter((e) => e.ts < cut).map((e) => e.id);
      if (gone.length) { events = events.filter((e) => e.ts >= cut); del(gone); }
      return gone.length;
    },

    // ---------- audit trail (append-only; there is deliberately no edit or delete) ----------
    addAudit(e) {
      audit.push(copy(e));
      if (db) try { db.transaction('audit', 'readwrite').objectStore('audit').add(e); } catch { /* ignore */ }
      if (audit.length > 50000) { // keep the newest 45,000; remember where the chain continues from
        const gone = audit.splice(0, audit.length - 45000);
        meta.auditAnchor = { seq: gone.at(-1).seq, hash: gone.at(-1).hash };
        saveMeta();
        if (db) try { const st = db.transaction('audit', 'readwrite').objectStore('audit'); gone.forEach((g) => st.delete(g.seq)); } catch { /* ignore */ }
      }
      return copy(e);
    },
    lastAudit: () => copy(audit.at(-1) || null),
    auditAnchor: () => copy(meta.auditAnchor || null),
    auditEntries: ({ limit = 500, before = null } = {}) => { const out = []; for (let i = audit.length - 1; i >= 0 && out.length < limit; i--) if (!before || audit[i].seq < before) out.push(copy(audit[i])); return out; },
    allAudit: () => audit.map(copy),
    /** (tests only) */
    _auditRaw: () => audit,

    // ---------- big files (floor-plan pictures, 3D scans) ----------
    putFile(key, blob) {
      if (!db) { memFiles.set(key, blob); return Promise.resolve(); }
      return new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || new Error('Couldn’t save the file (storage full?)')); });
    },
    getFile(key) {
      if (!db) return Promise.resolve(memFiles.get(key) || null);
      return new Promise((resolve) => { const r = db.transaction('files').objectStore('files').get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
    },
    deleteFile(key) {
      if (!db) { memFiles.delete(key); return Promise.resolve(); }
      return new Promise((resolve) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
    },

    // ---------- full backup (to move HQ to another computer/browser) ----------
    backup: () => ({ sentinel: 'hq-backup', version: 2, at: Date.now(), meta: copy(meta), events: events.map(copy), audit: audit.map(copy) }),
    restore(b) {
      if (b?.sentinel !== 'hq-backup' || !b.meta || !Array.isArray(b.events)) throw new Error('That isn’t a SENTINEL HQ backup file.');
      del(events.map((e) => e.id));
      meta = { ...blank, ...copy(b.meta) };
      events = b.events.map(copy).sort((x, y) => x.id - y.id);
      if (Array.isArray(b.audit)) {
        if (db) try { const st = db.transaction('audit', 'readwrite').objectStore('audit'); st.clear(); b.audit.forEach((x) => st.put(x)); } catch { /* ignore */ }
        audit = b.audit.map(copy).sort((x, y) => x.seq - y.seq);
      }
      meta.nextEventId = Math.max(meta.nextEventId || 1, ...events.map((e) => e.id + 1));
      saveMeta();
      events.forEach(put);
    },
  };
  return api;
}
