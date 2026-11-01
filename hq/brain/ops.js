// TRIAGE QUEUE + INCIDENTS (HQ's side). Events that matter become alerts; an operator acknowledges,
// escalates, dismisses (with a reason) or turns them into an incident with a reference number,
// an assignee, notes and a timeline. Everything is kept on the HQ computer only.
import { severityFor, alertTitle, alertExplanation, escalated, validSeverity, OPEN_ALERT, DISMISS_REASONS, canMove, incidentRef, INCIDENT_LABEL, SEV_RANK } from '../../shared/triage.js';
import { agentLabel } from '../../shared/crypto.js';
import { grade, cleanGradeRule } from '../../shared/grading.js';
import { hourStats } from '../../shared/baseline.js';
import { fatigueStats, digest } from '../../shared/fatigue.js';
import { missionById } from '../../shared/missions.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const MERGE_MS = 60000; // the same thing again within a minute adds to the open alert instead of a new row
const MERGE_LOW_MS = 5 * 60000; // Info/Advisory from the same Agent and kind: 5 minutes
const clean = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);

export class Ops {
  constructor({ hq, db }) {
    this.hq = hq; this.db = db;
    hq.on('event', (ev) => this.ingest(ev));
  }
  now() { return this.hq.now(); }

  roomOf(agentId) {
    const a = agentId && this.db.agent(agentId);
    const id = a?.place?.roomId;
    if (!id) return { roomId: null, room: '' };
    for (const f of this.hq.house().floors || []) { const r = f.rooms.find((x) => x.id === id); if (r) return { roomId: r.id, room: r.name }; }
    return { roomId: null, room: '' };
  }

  // ---------- alerts ----------
  alerts({ status = null, limit = 300 } = {}) {
    let list = this.db.docs('alerts').map((a) => (SEV_RANK[a.severity] ? a : { ...a, severity: validSeverity(a.severity) })); // pre-v3 alerts
    if (status === 'open') list = list.filter((a) => OPEN_ALERT.has(a.status));
    else if (status) list = list.filter((a) => a.status === status);
    return list.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
  /** Unhandled alerts (Info is for the record and never counts as waiting). */
  unhandled() { return this.db.docs('alerts').filter((a) => a.status === 'new' && validSeverity(a.severity) !== 'INFO').length; }

  /** A Mission Log event arrived: does it need triage? */
  ingest(ev) {
    const severity = severityFor(ev);
    if (!severity) return null;
    const { roomId, room } = this.roomOf(ev.agentId);
    const a = ev.agentId && this.db.agent(ev.agentId);
    const zone = a?.place?.zone || (missionById(a?.mission)?.outside ? a.settings?.watch : null) || (ev.agentId ? 'inside' : null);
    const cls = typeof ev.data?.class === 'string' ? ev.data.class : null;
    const where = ev.kind === 'perimeter' ? '' : room;
    return this.raise({ severity, title: alertTitle(ev, where), explanation: alertExplanation(ev), source: ev.agentId ? 'agent' : 'system', agentId: ev.agentId, roomId, room, eventIds: [ev.id], kind: ev.kind, ts: ev.ts, cls, zone });
  }

  /** Other parts of HQ (correlation rules, anomaly detection, tamper checks, network) raise alerts here. */
  raise({ severity, title, explanation = '', source = 'system', agentId = null, roomId = null, room = '', eventIds = [], kind = null, ts = this.now(), data = null, cls = null, zone = null }) {
    // grade it in context first (Alert State, what was seen, weather, pattern of life, your rules, snoozes)
    const g = grade({ severity: validSeverity(severity), kind, cls, zone, room, agentId, title, source }, this.gradeContext(agentId, kind, roomId, ts));
    if (g.suppressed) {
      if (g.snoozedBy) { const sz = this.db.doc('snoozes', g.snoozedBy.id); if (sz) { sz.held = (sz.held || 0) + 1; this.db.putDoc('snoozes', sz, 200); } }
      this.held = (this.held || 0) + 1;
      this.hq.logEvent({ kind: 'triage', message: `Held back${g.snoozedBy ? ' (snoozed)' : ''}: ${clean(title, 90)}${g.reasons.length ? ` — ${g.reasons.join('; ')}` : ''}` });
      return null;
    }
    const sev = g.severity;
    if (g.reasons.length) explanation = [explanation, `Graded: ${g.reasons.join('; ')}.`].filter(Boolean).join(' ');
    // Merge repeats: same Agent + same kind, still unhandled, within a minute
    const low = SEV_RANK[sev] <= SEV_RANK.ADVISORY;
    const recent = this.db.docs('alerts').reverse().find((a) => (a.status === 'new' || (low && a.status === 'acknowledged')) && a.kind === kind && a.agentId === agentId
      && (a.title === title ? ts - a.lastTs < MERGE_MS : low && agentId && SEV_RANK[a.severity] <= SEV_RANK.ADVISORY && ts - a.lastTs < MERGE_LOW_MS));
    if (recent) {
      recent.count = (recent.count || 1) + 1; recent.lastTs = ts;
      recent.eventIds = [...recent.eventIds, ...eventIds].slice(-50);
      recent.severity = validSeverity(recent.severity);
      if (SEV_RANK[sev] > SEV_RANK[recent.severity]) recent.severity = sev;
      return this.save(recent);
    }
    const a = this.agentName(agentId);
    const alert = {
      id: `ALT-${String(this.db.nextNumber('alert')).padStart(6, '0')}`, ts, lastTs: ts, severity: sev, title: clean(title, 90), explanation: clean(explanation, 240),
      source, agentId, agent: a, roomId, room, eventIds, kind, count: 1, status: 'new', data, cls, zone, graded: g.reasons,
      history: [{ ts, by: 'SENTINEL', action: 'raised', note: g.reasons.join('; ') }],
    };
    // correlation first: a rule that explains several open alerts folds them into this one
    if (source === 'correlation' && eventIds.length) {
      const ids = new Set(eventIds);
      for (const o of this.db.docs('alerts').filter((x) => x.status === 'new' && x.eventIds.some((e) => ids.has(e)))) {
        o.status = 'merged'; o.mergedInto = alert.id;
        o.history.push({ ts, by: 'SENTINEL', action: 'merged', note: `Explained by ${alert.id}: ${alert.title}` });
        this.save(o);
        alert.count += o.count || 1;
        alert.history.push({ ts, by: 'SENTINEL', action: 'merged', note: `Includes ${o.id} (${o.title})` });
      }
    }
    return this.save(alert, true);
  }
  /** What grading needs to know right now. */
  gradeContext(agentId, kind, roomId, ts) {
    const s = this.hq.settings();
    let expected = false;
    try {
      const b = this.hq.analytics?.ensureBaseline();
      const key = roomId || (agentId ? `agent:${agentId}` : null);
      if (b && !b.learning && key) expected = hourStats(b, key, ts).share >= 0.5;
    } catch { /* no history yet */ }
    const failed = kind === 'system' ? this.db.events({ since: ts - 10 * 60000, limit: 200 }).filter((e) => /^Failed login attempt/.test(e.message || '')).length : 0;
    return { mode: s.mode, now: ts, windMph: this.hq.weather?.wind ?? 0, expected, rules: this.gradeRules(), snoozes: this.snoozes(), recentFailedLogins: failed };
  }

  // ---------- grading rules, snoozes, fatigue, digest ----------
  gradeRules() { return this.db.docs('graderules').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((r) => ({ ...cleanGradeRule(r), order: r.order ?? 0 })); }
  saveGradeRule(r) {
    const rule = { ...cleanGradeRule(r), order: Number.isFinite(r.order) ? r.order : this.db.docs('graderules').length };
    const existed = !!this.db.doc('graderules', rule.id);
    this.db.putDoc('graderules', rule, 200);
    this.hq.logEvent({ kind: 'system', message: `Grading rule “${rule.name}” ${existed ? 'updated' : 'created'}${rule.enabled ? '' : ' (off)'}` });
    return rule;
  }
  deleteGradeRule(id) { const r = this.db.doc('graderules', id); if (!r) throw fail(404, 'No such rule.'); this.db.removeDocs('graderules', (x) => x.id === id); this.hq.logEvent({ kind: 'system', message: `Grading rule “${r.name}” deleted` }); return { ok: true }; }
  snoozes() { const now = this.now(); return this.db.docs('snoozes').filter((x) => x.until > now); }
  snooze({ scope, value, minutes, label = '', by = 'HQ' }) {
    if (!['agent', 'title', 'kind'].includes(scope) || !value) throw fail(400, 'Snooze what?');
    const m = Math.min(24 * 60, Math.max(5, Math.round(Number(minutes) || 60)));
    const sz = { id: `sz-${this.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, scope, value: clean(value, 90), label: clean(label || value, 90), until: this.now() + m * 60000, by, held: 0, ts: this.now() };
    this.db.putDoc('snoozes', sz, 200);
    this.hq.logEvent({ kind: 'triage', message: `Snoozed for ${m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`} by ${by}: ${sz.label}` });
    this.hq.broadcast({ t: 'snoozes', snoozes: this.snoozes() });
    return sz;
  }
  unsnooze(id, by = 'HQ') {
    const sz = this.db.doc('snoozes', id);
    if (!sz) throw fail(404, 'No such snooze.');
    this.db.removeDocs('snoozes', (x) => x.id === id);
    this.hq.logEvent({ kind: 'triage', message: `Snooze ended early by ${by}: ${sz.label}` });
    this.hq.broadcast({ t: 'snoozes', snoozes: this.snoozes() });
    return { ok: true };
  }
  fatigue() { return fatigueStats(this.db.docs('alerts'), this.now()); }
  digestNow() {
    const now = this.now();
    const d = digest({ alerts: this.db.docs('alerts'), events: this.db.events({ since: now - 86400000, limit: 20000 }), now, snoozed: this.held || 0 });
    const doc = { id: `dg-${now.toString(36)}`, ts: now, ...d };
    this.db.putDoc('digests', doc, 60);
    this.held = 0;
    this.hq.logEvent({ kind: 'digest', message: `${d.title}: ${d.lines.join(' ')}`.slice(0, 600) });
    this.hq.broadcast({ t: 'digest', digest: doc });
    return doc;
  }
  /** The daily digest, once a day at the time set in Administration (default 08:00). */
  tickDigest() {
    const s = this.hq.settings(), now = this.now(), d = new Date(now);
    const [h, m] = String(s.digestTime || '08:00').split(':').map(Number);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (s.digestOn === false || d.getHours() * 60 + d.getMinutes() < h * 60 + m || this.db.getSetting('digestDay', null) === key) return null;
    this.db.setSetting('digestDay', key);
    return this.digestNow();
  }
  agentName(agentId) { const a = agentId && this.db.agent(agentId); return a ? `${agentLabel(a)} ${a.codename}` : ''; }
  save(alert, isNew = false) {
    const out = this.db.putDoc('alerts', alert, 3000);
    this.hq.broadcast({ t: 'alert', alert: out, unhandled: this.unhandled() });
    if (isNew) this.hq.emit('alert', out);
    return out;
  }
  alert(id) { const a = this.db.doc('alerts', id); if (!a) throw fail(404, 'No such alert.'); return a; }

  /** Acknowledge / Escalate / Dismiss / (Convert is incidentFromAlerts). */
  act(id, action, { by = 'HQ', reason = '', note = '' } = {}) {
    const a = this.alert(id);
    const t = this.now();
    if (action === 'acknowledge') {
      if (!OPEN_ALERT.has(a.status)) throw fail(409, 'That alert is already closed.');
      a.status = 'acknowledged';
    } else if (action === 'escalate') {
      if (!OPEN_ALERT.has(a.status)) throw fail(409, 'That alert is already closed.');
      a.severity = escalated(a.severity); a.status = 'escalated';
    } else if (action === 'dismiss') {
      if (!OPEN_ALERT.has(a.status)) throw fail(409, 'That alert is already closed.');
      const r = clean(reason, 80);
      if (!r) throw fail(400, `Choose a reason: ${DISMISS_REASONS.join(', ')}.`);
      a.status = 'dismissed'; a.dismissReason = r;
    } else if (action === 'reopen') {
      if (a.status !== 'dismissed') throw fail(409, 'Only a dismissed alert can be reopened.');
      a.status = 'new'; delete a.dismissReason;
    } else throw fail(400, 'Unknown action.');
    if (!a.handledAt && action !== 'reopen') { a.handledAt = t; a.handledBy = by; }
    a.history.push({ ts: t, by, action, note: clean(action === 'dismiss' ? `${clean(reason, 80)}${note ? ` — ${note}` : ''}` : note, 200) });
    this.hq.logEvent({ kind: 'triage', message: `${a.id} ${{ acknowledge: 'acknowledged', escalate: `escalated to ${a.severity}`, dismiss: `dismissed (${a.dismissReason})`, reopen: 'reopened' }[action]} by ${by} — ${a.title}`, data: { alert: a.id } });
    return this.save(a);
  }

  // ---------- incidents ----------
  incidents() { return this.db.docs('incidents').sort((a, b) => b.createdAt - a.createdAt); }
  incident(id) { const i = this.db.docs('incidents').find((x) => x.id === id || x.ref === id); if (!i) throw fail(404, 'No such incident.'); return i; }
  saveIncident(inc) { const out = this.db.putDoc('incidents', inc, 2000); this.hq.broadcast({ t: 'incident', incident: out }); return out; }

  createIncident({ title = '', severity = null, alertIds = [], assignee = '', by = 'HQ', note = '' } = {}) {
    const alerts = alertIds.map((id) => this.alert(id));
    const t = this.now(), year = new Date(t).getFullYear();
    const sev = severity ? validSeverity(severity) : alerts.reduce((s, a) => (SEV_RANK[a.severity] > SEV_RANK[s] ? a.severity : s), 'INFO');
    const name = clean(title, 100) || alerts[0]?.title || 'Untitled incident';
    const inc = {
      id: `inc-${t.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ref: incidentRef(year, this.db.nextNumber(`inc-${year}`)),
      title: name, severity: sev, status: 'open', assignee: clean(assignee, 30) || by, createdAt: t, createdBy: by, updatedAt: t,
      alertIds: [], notes: [], timeline: [{ ts: t, by, text: `Incident opened${alerts.length ? ` from ${alerts.map((a) => a.id).join(', ')}` : ''}` }],
    };
    if (clean(note, 1000)) inc.notes.push({ ts: t, by, text: clean(note, 1000) });
    this.saveIncident(inc);
    this.hq.logEvent({ kind: 'triage', level: SEV_RANK[sev] >= 3 ? 'warn' : 'info', message: `${inc.ref} opened by ${by}: ${inc.title} (${sev})`, data: { incident: inc.ref } });
    if (alerts.length) this.linkAlerts(inc.id, alertIds, { by, silent: true });
    return this.incident(inc.id);
  }
  linkAlerts(id, alertIds, { by = 'HQ', silent = false } = {}) {
    const inc = this.incident(id);
    const t = this.now();
    for (const aid of alertIds) {
      const a = this.alert(aid);
      if (inc.alertIds.includes(a.id)) continue;
      inc.alertIds.push(a.id);
      if (!silent) inc.timeline.push({ ts: t, by, text: `Alert ${a.id} linked: ${a.title}` });
      a.status = 'incident'; a.incidentId = inc.id; a.incidentRef = inc.ref;
      if (!a.handledAt) { a.handledAt = t; a.handledBy = by; }
      a.history.push({ ts: t, by, action: 'incident', note: inc.ref });
      this.save(a);
    }
    inc.updatedAt = t;
    return this.saveIncident(inc);
  }
  updateIncident(id, patch = {}, { by = 'HQ' } = {}) {
    const inc = this.incident(id);
    const t = this.now(), log = [];
    if (patch.status && patch.status !== inc.status) {
      if (!canMove(inc.status, patch.status)) throw fail(409, `An incident can’t go from ${INCIDENT_LABEL[inc.status]} to ${INCIDENT_LABEL[patch.status] || patch.status}.`);
      log.push(`Status: ${INCIDENT_LABEL[inc.status]} → ${INCIDENT_LABEL[patch.status]}`);
      inc.status = patch.status;
      if (patch.status === 'resolved') inc.resolvedAt = t;
      if (patch.status === 'closed') inc.closedAt = t;
    }
    if ('assignee' in patch) { const v = clean(patch.assignee, 30); if (v !== inc.assignee) { log.push(`Assigned to ${v || 'nobody'}`); inc.assignee = v; } }
    if ('title' in patch) { const v = clean(patch.title, 100); if (v && v !== inc.title) { log.push(`Renamed “${v}”`); inc.title = v; } }
    if ('severity' in patch) { const v = validSeverity(patch.severity); if (v !== inc.severity) { log.push(`Severity ${inc.severity} → ${v}`); inc.severity = v; } }
    if (!log.length) return inc;
    for (const text of log) inc.timeline.push({ ts: t, by, text });
    inc.updatedAt = t;
    this.hq.logEvent({ kind: 'triage', message: `${inc.ref}: ${log.join(' · ')} (by ${by})`, data: { incident: inc.ref } });
    return this.saveIncident(inc);
  }
  addNote(id, text, { by = 'HQ' } = {}) {
    const inc = this.incident(id);
    const v = clean(text, 1000);
    if (!v) throw fail(400, 'Write a note first.');
    const t = this.now();
    inc.notes.push({ ts: t, by, text: v });
    inc.timeline.push({ ts: t, by, text: 'Note added' });
    inc.updatedAt = t;
    return this.saveIncident(inc);
  }
  /** Everything that happened, in order: the incident's own history plus the linked alerts' events. */
  incidentDetail(id) {
    const inc = this.incident(id);
    const alerts = inc.alertIds.map((a) => this.db.doc('alerts', a)).filter(Boolean);
    const ids = new Set(alerts.flatMap((a) => a.eventIds));
    const lo = Math.min(...alerts.map((a) => a.ts), inc.createdAt), hi = Math.max(...alerts.map((a) => a.lastTs || a.ts), inc.createdAt);
    const events = this.db.events({ since: lo - 10 * 60000, limit: 2000 }).filter((e) => ids.has(e.id) || (e.ts <= hi + 10 * 60000 && e.ts >= lo - 10 * 60000 && ['motion', 'door', 'sound', 'light', 'knock'].includes(e.kind)));
    const timeline = [
      ...inc.timeline.map((x) => ({ ...x, type: 'case' })),
      ...events.map((e) => ({ ts: e.ts, by: e.agentId ? this.agentName(e.agentId) : 'SENTINEL', text: e.message, type: ids.has(e.id) ? 'alert' : 'context', level: e.level })),
    ].sort((a, b) => a.ts - b.ts);
    return { incident: inc, alerts, timeline, window: { from: lo - 2 * 60000, to: hi + 2 * 60000 } };
  }
}
