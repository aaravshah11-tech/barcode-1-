// HQ's database: one SQLite file (data/sentinel.db) using Node's built-in SQLite.
// Nothing here ever stores images, video or audio — only events like "motion detected".
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
create table if not exists settings (key text primary key, value text not null);
create table if not exists agents (
  id text primary key, number integer not null, codename text not null, name text,
  token_hash text not null, mission text not null default 'standby', settings text not null default '{}',
  created_at integer not null, last_seen integer, battery real, charging integer, ua text, revoked integer not null default 0
);
create table if not exists pair_codes (code_hash text primary key, expires_at integer not null, used integer not null default 0);
create table if not exists events (
  id integer primary key autoincrement, ts integer not null, agent_id text, kind text not null,
  level text not null default 'info', message text not null, data text
);
create index if not exists events_ts on events(ts);
create table if not exists people (id text primary key, name text not null, enabled integer not null default 1, home integer not null default 0, last_seen integer, since integer);
create table if not exists devices (mac text primary key, ip text, name text, person_id text, hostname text, first_seen integer, last_seen integer, ignored integer not null default 0);
create table if not exists push_subs (id text primary key, endpoint text unique not null, keys text not null, label text, rules text not null default '{}', created_at integer not null);
create table if not exists sessions (token_hash text primary key, created_at integer not null, expires_at integer not null);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  return makeApi(db);
}

const json = (s, fallback) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };

function makeApi(db) {
  const q = (sql) => db.prepare(sql);
  const agentRow = (r) => (r ? {
    id: r.id, number: r.number, codename: r.codename, name: r.name || '', mission: r.mission, settings: json(r.settings, {}),
    createdAt: r.created_at, lastSeen: r.last_seen, battery: r.battery, charging: r.charging == null ? null : !!r.charging, ua: r.ua || '', revoked: !!r.revoked,
  } : null);
  const eventRow = (r) => r && ({ id: r.id, ts: r.ts, agentId: r.agent_id, kind: r.kind, level: r.level, message: r.message, data: json(r.data, null) });

  const api = {
    raw: db,
    close: () => db.close(),

    // ---------- settings (small JSON values) ----------
    getSetting(key, fallback = null) { const r = q('select value from settings where key = ?').get(key); return r ? json(r.value, fallback) : fallback; },
    setSetting(key, value) { q('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, JSON.stringify(value)); return value; },

    // ---------- agents ----------
    agents: () => q('select * from agents where revoked = 0 order by number').all().map(agentRow),
    agent: (id) => agentRow(q('select * from agents where id = ? and revoked = 0').get(id)),
    agentByTokenHash: (h) => agentRow(q('select * from agents where token_hash = ? and revoked = 0').get(h)),
    nextAgentNumber: () => (q('select max(number) as n from agents').get().n || 0) + 1,
    addAgent(a) {
      q(`insert into agents (id, number, codename, name, token_hash, mission, settings, created_at, ua) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(a.id, a.number, a.codename, a.name || null, a.tokenHash, a.mission || 'standby', JSON.stringify(a.settings || {}), a.createdAt || Date.now(), a.ua || null);
      return api.agent(a.id);
    },
    updateAgent(id, patch) {
      const map = { codename: 'codename', name: 'name', mission: 'mission', lastSeen: 'last_seen', battery: 'battery', charging: 'charging', ua: 'ua' };
      for (const [k, col] of Object.entries(map)) if (k in patch) q(`update agents set ${col} = ? where id = ?`).run(patch[k] == null ? null : typeof patch[k] === 'boolean' ? Number(patch[k]) : patch[k], id);
      if ('settings' in patch) q('update agents set settings = ? where id = ?').run(JSON.stringify(patch.settings || {}), id);
      return api.agent(id);
    },
    revokeAgent: (id) => q('update agents set revoked = 1, token_hash = ? where id = ?').run(`revoked:${id}:${Date.now()}`, id),

    // ---------- one-time pairing codes ----------
    addPairCode: (codeHash, expiresAt) => q('insert into pair_codes (code_hash, expires_at) values (?, ?)').run(codeHash, expiresAt),
    /** Marks the code used. Returns true only the first time, and only before it expires. */
    usePairCode(codeHash, now = Date.now()) {
      const r = q('update pair_codes set used = 1 where code_hash = ? and used = 0 and expires_at > ?').run(codeHash, now);
      return r.changes === 1;
    },
    prunePairCodes: (now = Date.now()) => q('delete from pair_codes where expires_at < ? or used = 1').run(now - 3600000),

    // ---------- Mission Log ----------
    addEvent(e) {
      const r = q('insert into events (ts, agent_id, kind, level, message, data) values (?, ?, ?, ?, ?, ?)')
        .run(e.ts || Date.now(), e.agentId || null, e.kind, e.level || 'info', e.message, e.data == null ? null : JSON.stringify(e.data));
      return eventRow(q('select * from events where id = ?').get(r.lastInsertRowid));
    },
    events({ limit = 200, before = null, since = null, kind = null } = {}) {
      const where = [], args = [];
      if (before) { where.push('id < ?'); args.push(before); }
      if (since) { where.push('ts >= ?'); args.push(since); }
      if (kind) { where.push('kind = ?'); args.push(kind); }
      return q(`select * from events ${where.length ? 'where ' + where.join(' and ') : ''} order by id desc limit ?`).all(...args, limit).map(eventRow);
    },
    allEvents: () => q('select * from events order by id').all().map(eventRow),
    /** Auto-delete old Mission Log entries. Returns how many were removed. */
    pruneEvents: (olderThanMs, now = Date.now()) => Number(q('delete from events where ts < ?').run(now - olderThanMs).changes),

    // ---------- people & Wi-Fi devices ----------
    people: () => q('select * from people order by name').all().map((r) => ({ id: r.id, name: r.name, enabled: !!r.enabled, home: !!r.home, lastSeen: r.last_seen, since: r.since })),
    addPerson: (p) => q('insert into people (id, name, enabled) values (?, ?, 1)').run(p.id, p.name),
    updatePerson(id, patch) {
      for (const [k, col] of Object.entries({ name: 'name', enabled: 'enabled', home: 'home', lastSeen: 'last_seen', since: 'since' })) {
        if (k in patch) q(`update people set ${col} = ? where id = ?`).run(typeof patch[k] === 'boolean' ? Number(patch[k]) : patch[k], id);
      }
    },
    removePerson(id) { q('update devices set person_id = null where person_id = ?').run(id); q('delete from people where id = ?').run(id); },
    devices: () => q('select * from devices order by last_seen desc').all().map((r) => ({ mac: r.mac, ip: r.ip, name: r.name || '', personId: r.person_id, hostname: r.hostname || '', firstSeen: r.first_seen, lastSeen: r.last_seen, ignored: !!r.ignored })),
    seenDevice(d, now = Date.now()) {
      q(`insert into devices (mac, ip, hostname, first_seen, last_seen) values (?, ?, ?, ?, ?)
         on conflict(mac) do update set ip = excluded.ip, last_seen = excluded.last_seen, hostname = coalesce(excluded.hostname, devices.hostname)`)
        .run(d.mac, d.ip, d.hostname || null, now, now);
    },
    updateDevice(mac, patch) {
      for (const [k, col] of Object.entries({ name: 'name', personId: 'person_id', ignored: 'ignored' })) {
        if (k in patch) q(`update devices set ${col} = ? where mac = ?`).run(typeof patch[k] === 'boolean' ? Number(patch[k]) : patch[k] || null, mac);
      }
    },
    removeDevice: (mac) => q('delete from devices where mac = ?').run(mac),

    // ---------- push subscriptions (alerts to your phone) ----------
    pushSubs: () => q('select * from push_subs order by created_at').all().map((r) => ({ id: r.id, endpoint: r.endpoint, keys: json(r.keys, {}), label: r.label || '', rules: json(r.rules, {}), createdAt: r.created_at })),
    savePushSub(s) {
      q(`insert into push_subs (id, endpoint, keys, label, rules, created_at) values (?, ?, ?, ?, ?, ?)
         on conflict(endpoint) do update set keys = excluded.keys, label = excluded.label, rules = excluded.rules`)
        .run(s.id, s.endpoint, JSON.stringify(s.keys), s.label || null, JSON.stringify(s.rules || {}), s.createdAt || Date.now());
      return api.pushSubs().find((x) => x.endpoint === s.endpoint);
    },
    updatePushRules: (id, rules) => q('update push_subs set rules = ? where id = ?').run(JSON.stringify(rules), id),
    removePushSub: (idOrEndpoint) => q('delete from push_subs where id = ? or endpoint = ?').run(idOrEndpoint, idOrEndpoint),

    // ---------- dashboard login sessions ----------
    addSession: (h, expiresAt) => q('insert into sessions (token_hash, created_at, expires_at) values (?, ?, ?)').run(h, Date.now(), expiresAt),
    sessionValid: (h, now = Date.now()) => !!q('select 1 from sessions where token_hash = ? and expires_at > ?').get(h, now),
    removeSession: (h) => q('delete from sessions where token_hash = ?').run(h),
    removeAllSessions: () => q('delete from sessions').run(),
  };
  return api;
}
