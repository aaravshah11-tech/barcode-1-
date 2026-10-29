// HQ's brain (runs inside the HQ page): who's online, the Mission Log, the threat level,
// recruiting, and signed orders to Agents. The dashboard, Agents and linked phones all talk to this.
import { computeThreat, ACTIVITY_KINDS, MODES, MODE_INFO, validMode, isArmed } from '../../shared/threat.js';
import { inQuietHours } from '../../shared/alert-rules.js';
import { randomToken, sha256, newId, pairCode, normalizeCode, signCommand, pickCodename, agentLabel } from '../../shared/crypto.js';
import { MISSIONS, missionById, cleanSettings } from '../../shared/missions.js';
import { sanitizeHouse, emptyHouse, pointInPolygon } from '../../shared/house.js';
import { addDiagSample, batteryAlert } from '../../shared/diag.js';
import { buildBriefing, dayStart } from '../../shared/briefing.js';
import { cleanShips } from '../../shared/feeds.js';

const DAY = 86400000;
export const DEFAULT_SETTINGS = {
  fx: true, retentionDays: 30, mode: 'home', theme: 'mi6', autoLockMin: 15, speedEvery: 0,
  nightStart: '22:30', nightEnd: '07:00', // when NIGHT is suggested (and the siren stays quiet)
  alarm: { enabled: true, siren: true, volume: 60, seconds: 30, quietStart: '23:00', quietEnd: '07:00' }, // LOCKDOWN alarm protocol
  location: null, // { name, lat, lon } (rounded to ~1 km) for weather and sunrise/sunset
  briefingAuto: true, // show the Mission Briefing each morning
  northDeg: 0, // which compass direction the top of the floor plan faces (for sun and shadows)
  ships: [], // GLOBAL INTEL ship watch list: [{ mmsi, name }]
  airspaceKm: 40, // GLOBAL INTEL airspace radar range
};
const time = (v, d) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : d);
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
    s.mode = validMode(s.mode);
    s.alarm = { ...DEFAULT_SETTINGS.alarm, ...(s.alarm || {}) };
    return s;
  }
  updateSettings(patch) {
    const s = { ...this.settings() };
    if ('fx' in patch) s.fx = !!patch.fx;
    if ('retentionDays' in patch) s.retentionDays = Math.min(3650, Math.max(1, Math.round(Number(patch.retentionDays) || 30)));
    const prevMode = s.mode;
    if ('mode' in patch && MODES.includes(patch.mode)) s.mode = patch.mode;
    for (const k of ['nightStart', 'nightEnd']) if (k in patch) s[k] = time(patch[k], s[k]);
    if ('speedEvery' in patch) s.speedEvery = [0, 1, 6, 24].includes(Number(patch.speedEvery)) ? Number(patch.speedEvery) : 0;
    if (patch.alarm && typeof patch.alarm === 'object') {
      const a = { ...s.alarm }, p = patch.alarm;
      if ('enabled' in p) a.enabled = !!p.enabled;
      if ('siren' in p) a.siren = !!p.siren;
      if ('volume' in p) a.volume = Math.min(100, Math.max(0, Math.round(Number(p.volume) || 0)));
      if ('seconds' in p) a.seconds = Math.min(300, Math.max(5, Math.round(Number(p.seconds) || 30)));
      for (const k of ['quietStart', 'quietEnd']) if (k in p) a[k] = /^\d{2}:\d{2}$/.test(String(p[k])) ? p[k] : '';
      s.alarm = a;
    }
    if ('theme' in patch && THEMES.includes(patch.theme)) s.theme = patch.theme;
    if ('briefingAuto' in patch) s.briefingAuto = !!patch.briefingAuto;
    if ('ships' in patch) s.ships = cleanShips(patch.ships);
    if ('airspaceKm' in patch) s.airspaceKm = [10, 25, 40, 80].includes(Number(patch.airspaceKm)) ? Number(patch.airspaceKm) : 40;
    if ('northDeg' in patch) s.northDeg = [0, 45, 90, 135, 180, 225, 270, 315].includes(Number(patch.northDeg)) ? Number(patch.northDeg) : 0;
    if ('location' in patch) {
      const l = patch.location, lat = Number(l?.lat), lon = Number(l?.lon);
      s.location = l && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
        ? { name: String(l.name || 'Home').replace(/[<>]/g, '').slice(0, 60), lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 } : null;
    }
    if ('autoLockMin' in patch) s.autoLockMin = [0, 5, 15, 30, 60].includes(Number(patch.autoLockMin)) ? Number(patch.autoLockMin) : 15;
    this.db.setSetting('hq', s);
    if ('mode' in patch && s.mode !== prevMode) {
      this.logEvent({ kind: 'system', level: s.mode === 'lockdown' ? 'alert' : 'info', message: `Security mode: ${s.mode.toUpperCase()}${patch.by ? ` (by ${String(patch.by).slice(0, 40)})` : ''} — ${MODE_INFO[s.mode].summary}`, data: { mode: s.mode, from: prevMode } });
      if (s.mode === 'lockdown') this.alarm({ reason: 'LOCKDOWN', siren: false, seconds: 8 });
      if (prevMode === 'lockdown') this.standDown();
      this.recomputeThreat();
    }
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
      net: this.netSummary?.() || null,
      weather: this.weather || null,
      messages: this.messages || [],
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
    // messages that arrived while it was away
    const waiting = (this.pending?.get(agent.id) || []).filter((m) => this.now() - m.ts < 1800000);
    this.pending?.delete(agent.id);
    if (waiting.length) setTimeout(() => waiting.forEach((m) => this.command(agent.id, 'message', m)), 500);
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
    if (typeof status.rtt === 'number') clean.rtt = Math.max(0, Math.min(60000, Math.round(status.rtt))); // link round-trip time (ms)
    if (typeof status.since === 'number' && status.since <= this.now() + 60000) clean.since = status.since; // when the Agent page started
    if (typeof status.net === 'string') clean.net = status.net.slice(0, 12); // e.g. "4g", "wifi"
    if (typeof status.downlink === 'number') clean.downlink = Math.max(0, Math.min(10000, Math.round(status.downlink * 10) / 10));
    o.status = { ...o.status, ...clean, at: this.now() };
    const patch = { lastSeen: this.now() };
    if ('battery' in clean) patch.battery = clean.battery;
    if ('charging' in clean) patch.charging = clean.charging;
    // diagnostics history + low-battery alerts
    if ('battery' in clean || 'rtt' in clean || 'charging' in clean) {
      const all = this.diagAll();
      all[agentId] = addDiagSample(all[agentId] || [], { battery: o.status.battery, charging: o.status.charging, rtt: clean.rtt }, this.now());
      this.db.setSetting('diag', all);
    }
    const a = this.db.agent(agentId);
    if (a && typeof o.status.battery === 'number') {
      const r = batteryAlert(a.battAlert || null, o.status.battery, !!o.status.charging);
      if (r.state !== (a.battAlert || null)) patch.battAlert = r.state;
      if (r.alert) this.logEvent({ kind: 'agent', agentId, level: 'warn', message: `${agentLabel(a)} ${a.codename}: battery ${r.alert} (${Math.round(o.status.battery * 100)}%) — plug it in` });
    }
    this.db.updateAgent(agentId, patch);
    this.pushAgent(agentId);
  }
  diagAll() { return this.db.getSetting('diag', {}) || {}; }
  /** Everything the Agent window's Diagnostics section shows. */
  agentDiag(id) {
    const a = this.db.agent(id);
    if (!a) return null;
    const o = this.online.get(id);
    const since = this.now() - 86400000;
    return {
      samples: this.diagAll()[id] || [],
      online: !!o, connectedAt: o?.connectedAt || null, status: o?.status || null, lastSeen: a.lastSeen || null,
      offline24h: this.db.events({ limit: 500, since }).filter((e) => e.agentId === id && e.kind === 'agent' && /offline$/.test(e.message)).length,
      ua: a.ua || null,
    };
  }
  /** MISSION BRIEFING for a day (0 = today so far, 1 = yesterday). */
  briefing(daysAgo = 1) {
    const now = this.now(), from = dayStart(now, daysAgo), to = daysAgo ? dayStart(now, daysAgo - 1) : now;
    return buildBriefing({ events: this.db.events({ limit: 20000, since: from }), agents: this.db.agents().map((a) => this.agentView(a)), house: this.house(), diag: this.diagAll(), from, to, now });
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
    // Whether this counts as an intrusion depends on the security mode (and, at night, on the Agent).
    const mode = this.settings().mode;
    const armed = isArmed(mode, a, kind);
    const ev = this.logEvent({ kind, agentId, level: armed ? 'alert' : e.level === 'warn' ? 'warn' : 'info', message: `${agentLabel(a)} ${a.codename}: ${String(e.message || kind).slice(0, 140)}`, data: { ...data, ...(armed ? { armed: mode } : {}) } });
    if (armed && mode === 'lockdown') this.alarm({ reason: `INTRUSION — ${a.name || a.codename}` });
    return ev;
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

  // ---------- comms: messages to Agents ----------
  /**
   * Send a message to one Agent, every Agent ('all') or every Agent in a room ('room:<id>').
   * Offline Agents get it when they reconnect (within 30 minutes).
   */
  sendMessage({ target = 'all', text = '', speak = false, from = 'HQ' } = {}) {
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return null;
    const agents = this.db.agents();
    let list = [], label = '';
    if (target === 'all') { list = agents; label = 'all Agents'; }
    else if (String(target).startsWith('room:')) {
      const roomId = String(target).slice(5);
      const room = this.house().floors.flatMap((f) => f.rooms).find((r) => r.id === roomId);
      list = agents.filter((a) => a.place?.roomId === roomId);
      label = room ? room.name : 'that room';
    } else { list = agents.filter((a) => a.id === target); label = list[0] ? `${agentLabel(list[0])} ${list[0].codename}` : ''; }
    if (!list.length) return null;
    const msg = { id: newId(), text, speak: !!speak, from: String(from).slice(0, 40), ts: this.now() };
    this.pending ||= new Map();
    let delivered = 0;
    for (const a of list) {
      if (this.command(a.id, 'message', msg)) delivered++;
      else this.pending.set(a.id, [...(this.pending.get(a.id) || []).filter((m) => this.now() - m.ts < 1800000), msg]);
    }
    this.messages = [{ ...msg, label, to: list.map((a) => a.id), acks: [] }, ...(this.messages || [])].slice(0, 20);
    this.logEvent({ kind: 'comms', message: `Message to ${label}: “${text}”${delivered < list.length ? ` (${list.length - delivered} offline — will be delivered when they reconnect)` : ''}` });
    this.broadcast({ t: 'comms', messages: this.messages });
    return { id: msg.id, delivered, queued: list.length - delivered };
  }
  /** An Agent's screen confirmed it saw a message. */
  agentAck(agentId, msgId) {
    const m = (this.messages || []).find((x) => x.id === msgId);
    const a = this.db.agent(agentId);
    if (!m || !a || m.acks.includes(agentId)) return;
    m.acks.push(agentId);
    this.logEvent({ kind: 'comms', agentId, message: `${agentLabel(a)} ${a.codename} acknowledged: “${m.text.slice(0, 60)}”` });
    this.broadcast({ t: 'comms', messages: this.messages });
  }

  // ---------- panic button & alarm protocol ----------
  /** PANIC: straight to LOCKDOWN, every Agent alerted. */
  panic(by = 'HQ') {
    this.logEvent({ kind: 'system', level: 'alert', message: `PANIC raised by ${String(by).slice(0, 40)}` });
    if (this.settings().mode !== 'lockdown') this.updateSettings({ mode: 'lockdown', by });
    this.alarm({ reason: 'PANIC — LOCKDOWN', force: true });
    return this.settings();
  }
  /** Tell every online Agent to flash red (and sound the siren, if allowed right now). */
  alarm({ reason = 'ALARM', siren = true, seconds = null, force = false } = {}) {
    const a = this.settings().alarm;
    if (!a.enabled && !force) return false;
    const quiet = inQuietHours(a.quietStart, a.quietEnd, new Date(this.now()));
    const payload = { on: true, reason: String(reason).slice(0, 60), seconds: seconds || a.seconds, siren: siren && a.siren && !quiet, volume: a.volume / 100 };
    let n = 0;
    for (const id of this.online.keys()) if (this.command(id, 'alarm', payload)) n++;
    if (siren) this.logEvent({ kind: 'system', level: 'alert', message: `Alarm protocol: ${n} Agent${n === 1 ? '' : 's'} alerted${payload.siren ? '' : quiet ? ' (siren silent — quiet hours)' : ' (no siren)'}` });
    this.emit('alarm', payload);
    return n;
  }
  standDown() { for (const id of this.online.keys()) this.command(id, 'alarm', { on: false }); this.logEvent({ kind: 'system', message: 'Alarm stood down' }); }

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
    if (typeof patch.nightArmed === 'boolean') changes.nightArmed = patch.nightArmed;
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
  /** Where an Agent sits on the house map (a floor + a spot in metres), or null to take it off the map. */
  placeAgent(id, place) {
    const a = this.db.agent(id);
    if (!a) return null;
    let clean = null;
    if (place) {
      const f = this.house().floors.find((x) => x.id === place.floorId);
      const x = Number(place.x), y = Number(place.y);
      if (!f || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 500 || Math.abs(y) > 500) return null;
      clean = { floorId: f.id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      const room = f.rooms.find((r) => pointInPolygon([clean.x, clean.y], r.points));
      if (room) clean.roomId = room.id;
      this.logEvent({ kind: 'agent', agentId: id, message: `${agentLabel(a)} ${a.codename} placed in ${room ? room.name : f.name}` });
    }
    this.db.updateAgent(id, { place: clean });
    this.pushAgent(id);
    return this.agentView(this.db.agent(id));
  }
  removeAgent(id) {
    const a = this.db.agent(id);
    if (!a) return false;
    this.command(id, 'disconnect', {});
    this.db.revokeAgent(id);
    const diag = this.diagAll(); if (diag[id]) { delete diag[id]; this.db.setSetting('diag', diag); }
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
