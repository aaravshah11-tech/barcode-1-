// TRIAGE QUEUE + INCIDENTS (HQ's side). Events that matter become alerts; an operator acknowledges,
// escalates, dismisses (with a reason) or turns them into an incident with a reference number,
// an assignee, notes and a timeline. Everything is kept on the HQ computer only.
import { severityFor, alertTitle, alertExplanation, escalated, validSeverity, OPEN_ALERT, DISMISS_REASONS, canMove, incidentRef, INCIDENT_LABEL, SEV_RANK } from '../../shared/triage.js';
import { agentLabel } from '../../shared/crypto.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const MERGE_MS = 60000; // the same thing again within a minute adds to the open alert instead of a new row
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
    let list = this.db.docs('alerts');
    if (status === 'open') list = list.filter((a) => OPEN_ALERT.has(a.status));
    else if (status) list = list.filter((a) => a.status === status);
    return list.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
  unhandled() { return this.db.docs('alerts').filter((a) => a.status === 'new').length; }

  /** A Mission Log event arrived: does it need triage? */
  ingest(ev) {
    const severity = severityFor(ev);
    if (!severity) return null;
    const { roomId, room } = this.roomOf(ev.agentId);
    return this.raise({ severity, title: alertTitle(ev, room), explanation: alertExplanation(ev), source: ev.agentId ? 'agent' : 'system', agentId: ev.agentId, roomId, room, eventIds: [ev.id], kind: ev.kind, ts: ev.ts });
  }

  /** Other parts of HQ (correlation rules, anomaly detection, tamper checks, network) raise alerts here. */
  raise({ severity, title, explanation = '', source = 'system', agentId = null, roomId = null, room = '', eventIds = [], kind = null, ts = this.now(), data = null }) {
    const sev = validSeverity(severity);
    // Merge repeats: same Agent + same kind, still unhandled, within a minute
    const recent = this.db.docs('alerts').reverse().find((a) => a.status === 'new' && a.kind === kind && a.agentId === agentId && a.title === title && ts - a.lastTs < MERGE_MS);
    if (recent) {
      recent.count = (recent.count || 1) + 1; recent.lastTs = ts;
      recent.eventIds = [...recent.eventIds, ...eventIds].slice(-50);
      if (SEV_RANK[sev] > SEV_RANK[recent.severity]) recent.severity = sev;
      return this.save(recent);
    }
    const a = this.agentName(agentId);
    const alert = {
      id: `ALT-${String(this.db.nextNumber('alert')).padStart(6, '0')}`, ts, lastTs: ts, severity: sev, title: clean(title, 90), explanation: clean(explanation, 240),
      source, agentId, agent: a, roomId, room, eventIds, kind, count: 1, status: 'new', data,
      history: [{ ts, by: 'SENTINEL', action: 'raised', note: '' }],
    };
    return this.save(alert, true);
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
    const sev = severity ? validSeverity(severity) : alerts.reduce((s, a) => (SEV_RANK[a.severity] > SEV_RANK[s] ? a.severity : s), 'LOW');
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
