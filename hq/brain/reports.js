// REPORTS (HQ's side): gathers the figures, numbers each report, keeps them, and writes the daily
// SITREP (07:00) and the weekly report (Monday 07:00) by itself while HQ is open.
import { reportData, sitrepText, ALL_SECTIONS, SECTIONS, isoWeek } from '../../shared/report.js';
import { missionById } from '../../shared/missions.js';
import { coverage } from '../../shared/coverage.js';

const DAY = 86400000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const SECTION_KEYS = new Set(SECTIONS.map(([k]) => k));
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

export class Reports {
  constructor({ hq, db }) { this.hq = hq; this.db = db; }
  start() { this.timer = setInterval(() => this.auto(), 10 * 60000); setTimeout(() => this.auto(), 30000); return this; }
  stop() { clearInterval(this.timer); }
  now() { return this.hq.now(); }

  input(from, to, filter = {}) {
    const net = this.hq.netmon?.stats || this.db.getSetting('netstats', null) || {};
    return {
      from, to, now: this.now(), filter,
      events: this.db.events({ since: from - 30 * DAY, limit: 200000 }).reverse(),
      alerts: this.db.docs('alerts'), incidents: this.db.docs('incidents'),
      agents: this.hq.snapshot().agents.map((a) => ({ ...a, missionName: missionById(a.mission)?.name || a.mission })),
      house: this.hq.house(), anomalies: this.db.docs('anomalies'), matches: this.db.docs('matches'),
      netDays: net.days || [], outages: net.outages || [],
    };
  }
  /** Things the operator should do (for the SITREP). */
  actions() {
    const out = [];
    const un = this.db.docs('alerts').filter((a) => a.status === 'new');
    if (un.length) out.push(`Handle ${un.length} unhandled alert${un.length === 1 ? '' : 's'} in Triage.`);
    const inc = this.db.docs('incidents').filter((i) => i.status === 'open' || i.status === 'investigating');
    if (inc.length) out.push(`Progress ${inc.length} active incident${inc.length === 1 ? '' : 's'}: ${inc.map((i) => i.ref).join(', ')}.`);
    const agents = this.hq.snapshot().agents;
    for (const a of agents.filter((x) => !x.online)) out.push(`${a.codename} is offline — check it.`);
    for (const a of agents.filter((x) => x.battery != null && x.battery < 0.2 && !x.charging)) out.push(`Charge ${a.codename} (${Math.round(a.battery * 100)}%).`);
    const cov = coverage(this.hq.house(), agents);
    if (cov.unmonitored.length && agents.length) out.push(`${cov.unmonitored.length} outside door${cov.unmonitored.length === 1 ? '/window is' : 's/windows are'} not watched (see Coverage).`);
    return out;
  }
  sitrepFor(data) {
    const s = this.hq.snapshot();
    return sitrepText(data, { state: s.settings.mode.toUpperCase(), threat: s.threat?.level || 'GREEN', agentsOnline: s.agents.filter((a) => a.online).length, agentsTotal: s.agents.length, actions: this.actions() });
  }
  /** The live SITREP for the last 24 hours (not stored). */
  liveSitrep() {
    const to = this.now(), from = to - DAY;
    const data = reportData(this.input(from, to));
    return { ref: `SITREP-${ymd(to)}`, title: 'Situation report', from, to, generatedAt: to, data, sitrep: this.sitrepFor(data) };
  }

  list() { return this.db.docs('reports').map(({ data, sitrep, ...meta }) => meta).sort((a, b) => b.generatedAt - a.generatedAt); }
  get(id) { const r = this.db.doc('reports', id); if (!r) throw fail(404, 'No such report.'); return r; }
  remove(id) { if (!this.db.doc('reports', id)) throw fail(404, 'No such report.'); this.db.removeDocs('reports', (r) => r.id === id); return { ok: true }; }

  /** kind: 'sitrep' | 'weekly' | 'custom' */
  generate({ kind = 'custom', from, to, title = '', sections = null, filter = {}, by = 'HQ' } = {}) {
    const now = this.now();
    if (kind === 'sitrep') { to = to ?? now; from = from ?? to - DAY; }
    if (kind === 'weekly') { // the last complete Monday–Sunday
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      to = to ?? d.getTime(); from = from ?? to - 7 * DAY;
    }
    from = Number(from); to = Number(to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw fail(400, 'Choose a start and an end date (the end after the start).');
    if (to - from > 366 * DAY) throw fail(400, 'Reports can cover up to a year.');
    const secs = (Array.isArray(sections) ? sections : kind === 'sitrep' ? [] : ALL_SECTIONS).filter((k) => SECTION_KEYS.has(k));
    const clean = { minSeverity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(filter?.minSeverity) ? filter.minSeverity : null, rooms: (filter?.rooms || []).slice(0, 50).map(String), agents: (filter?.agents || []).slice(0, 50).map(String) };
    const data = reportData(this.input(from, to, clean));
    if (!secs.includes('log')) data.log = [];
    const { year, week } = isoWeek(from + DAY);
    const ref = kind === 'sitrep' ? `SITREP-${ymd(to)}-${String(new Date(to).getHours()).padStart(2, '0')}${String(new Date(to).getMinutes()).padStart(2, '0')}`
      : kind === 'weekly' ? `RPT-${year}-W${String(week).padStart(2, '0')}`
        : `RPT-${new Date(now).getFullYear()}-${String(this.db.nextNumber(`rpt-${new Date(now).getFullYear()}`)).padStart(4, '0')}`;
    const rep = {
      id: `rep-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ref, kind, from, to, generatedAt: now, generatedBy: by, sections: secs, filter: clean,
      title: String(title || '').replace(/[<>]/g, '').trim().slice(0, 80) || { sitrep: 'Situation report', weekly: `Weekly security report — week ${week}`, custom: 'Security report' }[kind],
      data, sitrep: kind === 'sitrep' || kind === 'weekly' ? this.sitrepFor(data) : null,
    };
    this.db.removeDocs('reports', (r) => r.ref === ref); // regenerating replaces the old copy
    this.db.putDoc('reports', rep, 120);
    this.hq.logEvent({ kind: 'report', message: `${rep.ref} “${rep.title}” prepared by ${by}` });
    this.hq.broadcast({ t: 'reports' });
    return rep;
  }
  /** 07:00 daily SITREP, Monday 07:00 weekly report (only if not made already). */
  auto() {
    const now = this.now(), d = new Date(now);
    if (d.getHours() < 7) return;
    const have = new Set(this.db.docs('reports').map((r) => r.ref));
    const today7 = new Date(now).setHours(7, 0, 0, 0);
    if (!this.db.docs('reports').some((r) => r.kind === 'sitrep' && r.to >= today7 - 60000 && r.generatedBy === 'SENTINEL (automatic)')) this.generate({ kind: 'sitrep', to: today7, by: 'SENTINEL (automatic)' });
    const m = new Date(now); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    const { year, week } = isoWeek(m.getTime() - 6 * DAY);
    if (!have.has(`RPT-${year}-W${String(week).padStart(2, '0')}`) && this.db.events({ since: m.getTime() - 7 * DAY, limit: 1 }).length) this.generate({ kind: 'weekly', by: 'SENTINEL (automatic)' });
  }
}
