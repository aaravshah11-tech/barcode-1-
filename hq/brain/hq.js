// HQ's brain (runs inside the HQ page): who's online, the Mission Log, the threat level,
// recruiting, and signed orders to Agents. The dashboard, Agents and linked phones all talk to this.
import { computeThreat, ACTIVITY_KINDS } from '../../shared/threat.js';
import { randomToken, sha256, newId, pairCode, normalizeCode, signCommand, pickCodename, agentLabel } from '../../shared/crypto.js';
import { MISSIONS, missionById, cleanSettings } from '../../shared/missions.js';
import { sanitizeHouse, emptyHouse } from '../../shared/house.js';

const DAY = 86400000;
export const DEFAULT_SETTINGS = { fx: true, retentionDays: 30, mode: 'home', theme: 'mi6', autoLockMin: 15 };
const THEMES = ['mi6', 'classic', 'redops'];
const PAIR_MINUTES = 10;

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  off(name, fn) { this.handlers[name] = (this.handlers[name] || []).filter((f) => f !== fn); }
  emit(name, ...args) { for (const f of this.handlers[name] || []) { try { f(...args); } catch (e) { console.error(e); } } }
}

export class HQ extends Emitter {
  constructor({ db, now = () => Date.now() }) {
    super();
    this.db = db;
    this.now = now;
    this.online = new Map(); // agentId -> { sendRaw, close, token, mission, status }
    this.dashboards = new Set(); // { send(text) } — this page and linked phones
    this.threat = null;
    this.timers = [];
    this.info = {}; // filled in by the network layer (HQ's address etc.)
  }

  start() {
    this.recomputeThreat(false);
    this.timers.push(setInterval(() => this.recomputeThreat(), 30000));
    this.timers.push(setInterval(() => this.prune(), 3600000));
    this.prune();
    return this;
  }
  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  settings() {
    const s = { ...DEFAULT_SETTINGS, ...(this.db.getSetting('hq', {}) || {}) };
    if (!['home', 'away'].includes(s.mode)) s.mode = 'home';
    return s;
  }
  updateSettings(patch) {
    const s = { ...this.settings() };
    if ('fx' in patch) s.fx = !!patch.fx;
    if ('retentionDays' in patch) s.retentionDays = Math.min(3650, Math.max(1, Math.round(Number(patch.retentionDays) || 30)));
    if ('mode' in patch && ['home', 'away'].includes(patch.mode)) s.mode = patch.mode;
    if ('theme' in patch && THEMES.includes(patch.theme)) s.theme = patch.theme;
    if ('autoLockMin' in patch) s.autoLockMin = [0, 5, 15, 30, 60].includes(Number(patch.autoLockMin)) ? Number(patch.autoLockMin) : 15;
    this.db.setSetting('hq', s);
    if ('mode' in patch) { this.logEvent({ kind: 'system', message: s.mode === 'away' ? 'Set to AWAY — nobody’s home' : 'Set to HOME' }); this.recomputeThreat(); }
    if ('fx' in patch || 'theme' in patch) for (const id of this.online.keys()) this.command(id, 'configure', { fx: s.fx, theme: s.theme });
    this.broadcast({ t: 'settings', settings: s });
    if ('retentionDays' in patch) this.prune();
    return s;
  }

  // ---------- the house (rooms, floors, doors, windows) ----------
  house() { return this.db.getSetting('house', null) || emptyHouse(); }
  saveHouse(h) {
    const clean = sanitizeHouse(h);
    this.db.setSetting('house', clean);
    this.broadcast({ t: 'house', house: clean });
    return clean;
  }

  // ---------- snapshot for dashboards ----------
  agentView(a) {
    const on = this.online.get(a.id);
    const { tokenHash, revoked, ...rest } = a;
    return { ...rest, label: agentLabel(a), online: !!on, status: on?.status || null, lastSeen: on ? this.now() : a.lastSeen };
  }
  snapshot() {
    return {
      t: 'state',
      agents: this.db.agents().map((a) => this.agentView(a)),
      events: this.db.events({ limit: 150 }),
      threat: this.threat,
      settings: this.settings(),
      house: this.house(),
      missions: MISSIONS,
      info: this.info,
      now: this.now(),
    };
  }
  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const d of this.dashboards) d.send(text);
    // INTEL SCREEN Agents show the dashboard too (read-only).
    for (const o of this.online.values()) if (o.mission === 'intel') o.sendRaw?.(text);
    this.emit('broadcast', msg);
  }
  pushAgent(id) { const a = this.db.agent(id); if (a) this.broadcast({ t: 'agent', agent: this.agentView(a) }); }

  // ---------- Mission Log ----------
  logEvent(e) {
    const ev = this.db.addEvent({ ts: this.now(), ...e });
    this.broadcast({ t: 'event', event: ev });
    this.emit('event', ev);
    if (ACTIVITY_KINDS.has(ev.kind)) this.recomputeThreat();
    return ev;
  }
  recomputeThreat(announce = true) {
    const now = this.now();
    const t = computeThreat({ events: this.db.events({ since: now - 20 * 60000, limit: 500 }), mode: this.settings().mode, now });
    const prev = this.threat;
    this.threat = t;
    if (!prev || prev.level !== t.level || prev.reason !== t.reason || prev.away !== t.away) {
      this.broadcast({ t: 'threat', threat: t });
      if (announce && prev && prev.level !== t.level) {
        const ev = this.db.addEvent({ ts: now, kind: 'threat', level: t.level === 'RED' ? 'alert' : t.level === 'AMBER' ? 'warn' : 'info', message: `Threat level ${t.level} — ${t.reason}`, data: { level: t.level } });
        this.broadcast({ t: 'event', event: ev });
        this.emit('threat', t, prev);
      }
    }
    return t;
  }
  prune() {
    const n = this.db.pruneEvents(this.settings().retentionDays * DAY, this.now());
    this.db.prunePairCodes(this.now());
    return n;
  }

  // ---------- recruiting Agents, linking phones ----------
  newPairCode(role = 'agent') {
    const code = pairCode();
    const expiresAt = this.now() + PAIR_MINUTES * 60000;
    this.db.addPairCode(sha256(code), expiresAt, role);
    return { code, expiresAt, role };
  }
  /** A new device presents a one-time code. Returns its credentials, or null. */
  claimPairCode(code, { ua = '', label = '' } = {}) {
    const role = this.db.usePairCode(sha256(normalizeCode(code)), this.now());
    if (!role) return null;
    const token = randomToken();
    if (role === 'viewer') {
      const v = this.db.addViewer({ id: newId(), tokenHash: sha256(token), label: String(label || deviceName(ua)).slice(0, 40), createdAt: this.now(), lastSeen: this.now() });
      this.logEvent({ kind: 'system', message: `Phone “${v.label}” linked to HQ` });
      this.broadcast({ t: 'viewers', viewers: this.viewers() });
      return { role, viewerId: v.id, token, label: v.label };
    }
    const a = this.db.addAgent({
      id: newId(), number: this.db.nextAgentNumber(), codename: pickCodename(this.db.agents().map((x) => x.codename)),
      tokenHash: sha256(token), mission: 'standby', settings: {}, createdAt: this.now(), ua: String(ua).slice(0, 300),
    });
    this.logEvent({ kind: 'agent', agentId: a.id, message: `${agentLabel(a)} “${a.codename}” recruited` });
    this.pushAgent(a.id);
    return { role, agentId: a.id, token, codename: a.codename, number: a.number, label: agentLabel(a) };
  }
  agentByToken(token) { return token ? this.db.agentByTokenHash(sha256(token)) : null; }
  viewerByToken(token) { return token ? this.db.viewerByTokenHash(sha256(token)) : null; }
  viewers() { return this.db.viewers().map(({ tokenHash, ...v }) => v); }
  removeViewer(id) {
    const v = this.db.viewers().find((x) => x.id === id);
    if (!v) return false;
    this.db.removeViewer(id);
    this.emit('viewerRemoved', id);
    this.logEvent({ kind: 'system', level: 'warn', message: `Phone “${v.label}” unlinked` });
    this.broadcast({ t: 'viewers', viewers: this.viewers() });
    return true;
  }

  // ---------- live Agents ----------
  agentOnline(agent, conn) {
    const prev = this.online.get(agent.id);
    if (prev) prev.close?.('replaced');
    this.online.set(agent.id, { conn, sendRaw: conn.sendRaw, close: conn.close, token: conn.token, mission: agent.mission, status: {}, connectedAt: this.now() });
    this.db.updateAgent(agent.id, { lastSeen: this.now() });
    if (!prev) this.logEvent({ kind: 'agent', agentId: agent.id, message: `${agentLabel(agent)} “${agent.codename}” online` });
    this.pushAgent(agent.id);
    return { t: 'welcome', now: this.now(), agentId: agent.id, codename: agent.codename, label: agentLabel(agent), name: agent.name, mission: agent.mission, settings: cleanSettings(agent.mission, agent.settings), fx: this.settings().fx, theme: this.settings().theme };
  }
  agentOffline(agentId, conn) {
    const cur = this.online.get(agentId);
    if (!cur || (conn && cur.conn !== conn)) return; // an older connection closing after a newer one took over
    this.online.delete(agentId);
    const a = this.db.agent(agentId);
    if (!a) return;
    this.db.updateAgent(agentId, { lastSeen: this.now() });
    this.logEvent({ kind: 'agent', agentId, level: 'warn', message: `${agentLabel(a)} “${a.codename}” offline` });
    this.emit('agentOffline', a);
    this.pushAgent(agentId);
  }
  agentStatus(agentId, status) {
    const o = this.online.get(agentId);
    if (!o) return;
    const clean = {};
    if (typeof status.battery === 'number') clean.battery = Math.max(0, Math.min(1, status.battery));
    if (typeof status.charging === 'boolean') clean.charging = status.charging;
    if (typeof status.visible === 'boolean') clean.visible = status.visible;
    if (typeof status.state === 'string') clean.state = status.state.slice(0, 80);
    if (typeof status.level === 'number') clean.level = Math.round(status.level * 10) / 10; // e.g. sound dB or brightness %
    o.status = { ...o.status, ...clean, at: this.now() };
    const patch = { lastSeen: this.now() };
    if ('battery' in clean) patch.battery = clean.battery;
    if ('charging' in clean) patch.charging = clean.charging;
    this.db.updateAgent(agentId, patch);
    this.pushAgent(agentId);
  }
  /** An Agent reports something (motion, door, sound…). Only text and numbers are accepted. */
  agentEvent(agentId, e) {
    const a = this.db.agent(agentId);
    if (!a) return null;
    const kind = String(e.kind || '');
    const allowed = new Set([...(missionById(a.mission)?.eventKinds || []), 'agent']);
    if (!allowed.has(kind)) return null;
    const data = {};
    for (const [k, v] of Object.entries(e.data || {})) if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 60)) data[k] = v;
    return this.logEvent({ kind, agentId, level: e.level === 'alert' || e.level === 'warn' ? e.level : 'info', message: `${agentLabel(a)} ${a.codename}: ${String(e.message || kind).slice(0, 140)}`, data });
  }
  /** Agents can only change their own on-screen zone choices (no images involved). */
  agentSetGrid(agentId, key, cells) {
    const a = this.db.agent(agentId);
    const def = missionById(a?.mission)?.settings.find((s) => s.key === key && s.type === 'grid');
    if (!def) return;
    const settings = cleanSettings(a.mission, { ...a.settings, [key]: cells });
    this.db.updateAgent(agentId, { settings: { ...a.settings, ...settings } });
    this.pushAgent(agentId);
  }

  /** LIVE VIEW: a camera picture goes straight to the open dashboards. It is never stored or logged. */
  agentFrame(agentId, f) {
    const msg = typeof f.data === 'string' && f.data.startsWith('data:image/jpeg;base64,') && f.data.length < 96000 ? { t: 'frame', agentId, data: f.data }
      : typeof f.error === 'string' ? { t: 'frame', agentId, error: f.error.slice(0, 200) } : null;
    if (!msg) return;
    const text = JSON.stringify(msg);
    for (const d of this.dashboards) d.send(text); // dashboards only — not INTEL SCREEN Agents
  }

  // ---------- orders to Agents (signed) ----------
  command(agentId, action, payload = {}) {
    const o = this.online.get(agentId);
    if (!o) return false;
    o.sendRaw(JSON.stringify({ t: 'cmd', cmd: signCommand(o.token, { action, payload }) }));
    return true;
  }
  updateAgent(id, patch) {
    const a = this.db.agent(id);
    if (!a) return null;
    const changes = {};
    if (typeof patch.codename === 'string' && patch.codename.trim()) changes.codename = patch.codename.trim().toUpperCase().slice(0, 24);
    if (typeof patch.name === 'string') changes.name = patch.name.trim().slice(0, 40);
    const mission = patch.mission && missionById(patch.mission) ? patch.mission : a.mission;
    if (mission !== a.mission) changes.mission = mission;
    if (patch.settings || mission !== a.mission) changes.settings = { ...a.settings, ...cleanSettings(mission, { ...a.settings, ...(patch.settings || {}) }) };
    const b = this.db.updateAgent(id, changes);
    if (changes.codename && changes.codename !== a.codename) this.logEvent({ kind: 'agent', agentId: id, message: `${agentLabel(a)} renamed “${a.codename}” → “${b.codename}”` });
    if (changes.mission) this.logEvent({ kind: 'agent', agentId: id, message: `${agentLabel(b)} ${b.codename} assigned ${missionById(mission).name}` });
    const o = this.online.get(id);
    if (o) {
      o.mission = b.mission;
      this.command(id, 'configure', { codename: b.codename, name: b.name, mission: b.mission, settings: cleanSettings(b.mission, b.settings), fx: this.settings().fx, theme: this.settings().theme });
      if (b.mission === 'intel') o.sendRaw(JSON.stringify(this.snapshot()));
    }
    this.pushAgent(id);
    return this.agentView(b);
  }
  removeAgent(id) {
    const a = this.db.agent(id);
    if (!a) return false;
    this.command(id, 'disconnect', {});
    this.db.revokeAgent(id);
    const o = this.online.get(id);
    this.online.delete(id);
    setTimeout(() => o?.close?.('disconnected'), 300);
    this.logEvent({ kind: 'agent', agentId: id, level: 'warn', message: `${agentLabel(a)} “${a.codename}” disconnected by HQ` });
    this.broadcast({ t: 'agentRemoved', id });
    return true;
  }
}

export function deviceName(ua = '') {
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Phone';
}
