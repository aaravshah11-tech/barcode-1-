// FLEET (HQ's side): the registry rows with health scores, bulk actions, day/night mission profiles,
// "hasn't reported in X minutes" advisories and the weekly fleet health summary.
import { hardwareFromUA, uptimePct } from '../../shared/register.js';
import { MISSIONS, missionById, armable } from '../../shared/missions.js';
import { healthScore, phaseAt, profileMission, staleAgents, fleetSummary } from '../../shared/fleet.js';
import { VERSION } from '../../shared/changelog.js';

const DAY = 86400000;
const fail = (status, message) => Object.assign(new Error(message), { status });

export class Fleet {
  constructor({ hq, db }) { this.hq = hq; this.db = db; this.warned = new Set(); }
  start() { this.timer = setInterval(() => this.tick(), 60000); setTimeout(() => this.tick(), 5000); return this; }
  stop() { clearInterval(this.timer); }

  /** Every Agent with its hardware, uptime, signal, last report, version and health score. */
  rows() {
    const now = this.hq.now(), week = now - 7 * DAY;
    const events = this.db.events({ since: now - 30 * DAY, limit: 50000 });
    return this.hq.snapshot().agents.map((a) => {
      const mine = events.filter((e) => e.agentId === a.id);
      const mlog = a.missionLog || [{ mission: a.mission, at: a.recruitedAt || a.createdAt || null }];
      const st = a.status || {};
      const row = {
        id: a.id, label: a.label, codename: a.codename, name: a.name, mission: a.mission, missionName: missionById(a.mission)?.name || a.mission, online: a.online,
        hardware: hardwareFromUA(a.ua), recruitedAt: a.recruitedAt || a.createdAt || null, lastSeen: a.lastSeen, battery: a.battery, charging: a.charging,
        uptime7d: uptimePct(events, a.id, week, now, a.online), uptime30d: uptimePct(events, a.id, now - 30 * DAY, now, a.online),
        calibratedAt: a.calibratedAt || null, notes: a.notes || '', lastTamper: a.lastTamper || null, place: a.place || null,
        missionLog: mlog.map((x) => ({ ...x, name: MISSIONS.find((mi) => mi.id === x.mission)?.name || x.mission })),
        tampers: mine.filter((e) => e.kind === 'tamper').slice(0, 10),
        history: mine.filter((e) => e.kind !== 'agent').slice(0, 15).map((e) => ({ ts: e.ts, kind: e.kind, level: e.level, message: e.message })),
        lastEvent: mine.find((e) => e.kind !== 'agent') || null,
        version: st.version || a.version || null, rtt: st.rtt ?? null, net: st.net || null,
        profiles: a.profiles || { on: false, day: a.mission, night: a.mission },
        armable: armable(a),
      };
      row.health = healthScore({ ...row, tampers7d: mine.filter((e) => e.kind === 'tamper' && e.ts >= week).length,
        offline24h: mine.filter((e) => e.kind === 'agent' && e.ts >= now - DAY && /offline$/.test(e.message)).length }, VERSION);
      return row;
    });
  }
  summary() { return { ...fleetSummary(this.rows()), version: VERSION, phase: phaseAt(this.hq.now(), this.hq.settings().location) }; }

  /** One action on several Agents: change mission, Identify (flash + beep), or update (reload the newest version). */
  bulk({ ids = [], action, mission } = {}) {
    const agents = this.db.agents().filter((a) => ids.includes(a.id));
    if (!agents.length) throw fail(400, 'Pick at least one Agent.');
    let done = 0, offline = 0;
    if (action === 'mission') {
      if (!missionById(mission)) throw fail(400, 'Unknown mission.');
      for (const a of agents) { this.hq.updateAgent(a.id, { mission }); done++; }
    } else if (action === 'identify' || action === 'update') {
      for (const a of agents) { if (this.hq.command(a.id, action === 'identify' ? 'find' : 'reload')) done++; else offline++; }
    } else throw fail(400, 'Unknown action.');
    const what = { mission: `assigned ${missionById(mission)?.name}`, identify: 'asked to identify themselves', update: 'told to load the newest version' }[action];
    this.hq.logEvent({ kind: 'agent', message: `${done} Agent${done === 1 ? '' : 's'} ${what}${offline ? ` (${offline} offline)` : ''}` });
    return { done, offline };
  }

  /** Every minute: switch day/night profiles at sunrise/sunset, and warn once about Agents that went quiet. */
  tick() {
    const now = this.hq.now(), s = this.hq.settings();
    const phase = phaseAt(now, s.location);
    for (const a of this.db.agents()) {
      const want = profileMission(a, phase);
      if (want && missionById(want) && a.profileApplied !== `${phase}:${want}`) {
        this.db.updateAgent(a.id, { profileApplied: `${phase}:${want}` });
        this.hq.updateAgent(a.id, { mission: want });
        this.hq.logEvent({ kind: 'agent', agentId: a.id, message: `${a.codename}: ${phase === 'night' ? 'sunset' : 'sunrise'} — switched to its ${phase} mission (${missionById(want).name})` });
      }
    }
    const stale = staleAgents(this.hq.snapshot().agents, now, s.staleMinutes || 15);
    for (const x of stale) {
      if (this.warned.has(x.id)) continue;
      this.warned.add(x.id);
      this.hq.logEvent({ kind: 'agent', agentId: x.id, level: 'warn', message: `${x.label} ${x.codename} hasn’t reported in ${x.mins} minutes — check its power and Wi-Fi`, data: { advisory: 'stale', mins: x.mins } });
    }
    for (const id of [...this.warned]) if (!stale.some((x) => x.id === id)) this.warned.delete(id);
    // the weekly fleet health summary, Sunday evening (once)
    const d = new Date(now);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (d.getDay() === 0 && d.getHours() >= 18 && this.db.getSetting('fleetWeekly', null) !== key) {
      this.db.setSetting('fleetWeekly', key);
      const sum = fleetSummary(this.rows());
      this.hq.logEvent({ kind: 'agent', message: `Weekly fleet health: ${sum.headline}${sum.lines.length ? ` ${sum.lines.join(' · ')}` : ''}`.slice(0, 600) });
    }
  }
}
