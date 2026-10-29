// ANALYSIS (HQ's side): runs the correlation rules on every event, and compares activity with the
// household's normal pattern of life. Conclusions go in the Mission Log; anything that needs a
// decision goes to the Triage queue with its explanation and confidence.
import { Correlator, cleanRule, DEFAULT_RULES, describeMatch } from '../../shared/correlate.js';
import { buildBaseline, unusualTime, unusuallyBusy, missingActivity, profile, LEARN_DAYS, MIN_DAYS } from '../../shared/baseline.js';
import { ACTIVITY_KINDS } from '../../shared/threat.js';

const HOUR = 3600000;
const fail = (status, message) => Object.assign(new Error(message), { status });

export class Analytics {
  constructor({ hq, db }) {
    this.hq = hq; this.db = db;
    this.correlator = new Correlator(this.rules());
    this.baseline = null; this.builtFor = 0;
    this.hour = { start: 0, counts: new Map() }; // events per place in the current hour
    this.flagged = new Set(); // one anomaly per place, hour and type per day
    hq.on('event', (ev) => this.onEvent(ev));
  }
  start() { this.timer = setInterval(() => this.tick(), 60000); return this; }
  stop() { clearInterval(this.timer); }
  now() { return this.hq.now(); }

  // ---------- rules ----------
  rules() {
    if (!this.db.getSetting('rulesSeeded', false)) { DEFAULT_RULES.forEach((r) => this.db.putDoc('rules', r)); this.db.setSetting('rulesSeeded', true); }
    return this.db.docs('rules').map(cleanRule);
  }
  saveRule(r) {
    const rule = cleanRule(r);
    const existed = !!this.db.doc('rules', rule.id);
    this.db.putDoc('rules', rule, 200);
    this.correlator.setRules(this.rules());
    this.hq.logEvent({ kind: 'system', message: `Correlation rule “${rule.name}” ${existed ? 'updated' : 'created'}${rule.enabled ? '' : ' (off)'}` });
    return rule;
  }
  deleteRule(id) {
    const r = this.db.doc('rules', id);
    if (!r) throw fail(404, 'No such rule.');
    this.db.removeDocs('rules', (x) => x.id === id);
    this.correlator.setRules(this.rules());
    this.hq.logEvent({ kind: 'system', message: `Correlation rule “${r.name}” deleted` });
    return { ok: true };
  }
  /** How often would this rule have fired over the last few days? (Nothing is logged.) */
  testRule(r, days = 7) {
    const rule = cleanRule(r), now = this.now();
    const c = new Correlator([{ ...rule, enabled: true, modes: ['home', 'away', 'night', 'lockdown'] }]);
    const events = this.db.events({ since: now - days * 86400000, limit: 50000 }).reverse();
    const hits = [];
    for (const ev of events) for (const m of c.feed(ev, this.ctx())) hits.push({ ts: ev.ts, text: describeMatch(m) });
    return { days, count: hits.length, examples: hits.slice(-5).reverse() };
  }
  matches() { return this.db.docs('matches').sort((a, b) => b.ts - a.ts).slice(0, 50); }

  ctx() {
    return {
      mode: this.hq.settings().mode,
      roomOf: (agentId) => this.hq.ops.roomOf(agentId).roomId,
      ownerOf: (ev) => ev?.data?.owner || '',
    };
  }

  // ---------- every event ----------
  onEvent(ev) {
    if (['correlation', 'anomaly', 'triage'].includes(ev.kind)) return;
    for (const m of this.correlator.feed(ev, this.ctx())) this.matched(m);
    if (ACTIVITY_KINDS.has(ev.kind)) this.pattern(ev);
  }
  matched(m) {
    const text = describeMatch(m);
    const last = m.events.at(-1);
    const { roomId, room } = this.hq.ops.roomOf(m.events.find((e) => e.agentId)?.agentId);
    this.db.putDoc('matches', { id: `m-${last.id}-${m.rule.id}`, ts: last.ts, rule: m.rule.id, name: m.rule.name, label: m.rule.label, likely: m.likely, text, level: m.rule.level }, 300);
    this.hq.logEvent({ kind: 'correlation', level: m.rule.level === 'INFO' ? 'info' : 'warn', message: text, data: { rule: m.rule.id, label: m.rule.label, likely: m.likely || '' } });
    if (m.rule.level !== 'INFO') {
      this.hq.ops.raise({ severity: m.rule.level, title: `${m.rule.label}${m.likely ? ` (likely: ${m.likely})` : ''}${room ? ` — ${room}` : ''}`, explanation: `Rule “${m.rule.name}”: ${m.events.length} signals in ${m.seconds} s.`, source: 'correlation', kind: `rule:${m.rule.id}`, roomId, room, eventIds: m.events.map((e) => e.id), ts: last.ts });
    }
  }

  // ---------- pattern of life ----------
  placeOf(agentId) {
    const { roomId, room } = this.hq.ops.roomOf(agentId);
    if (roomId) return { key: roomId, name: room };
    const a = agentId && this.db.agent(agentId);
    return a ? { key: `agent:${a.id}`, name: a.name || a.codename } : null;
  }
  ensureBaseline() {
    const now = this.now(), day = new Date(now).setHours(0, 0, 0, 0);
    if (this.baseline && this.builtFor === day) return this.baseline;
    const events = this.db.events({ since: day - LEARN_DAYS * 86400000, limit: 100000 });
    this.baseline = buildBaseline(events, { now, keyOf: (e) => this.placeOf(e.agentId)?.key || null });
    this.builtFor = day;
    return this.baseline;
  }
  rebuild() { this.builtFor = 0; return this.ensureBaseline(); }
  pattern(ev) {
    const place = this.placeOf(ev.agentId);
    if (!place) return;
    const b = this.ensureBaseline();
    const hs = Math.floor(ev.ts / HOUR) * HOUR;
    if (this.hour.start !== hs) this.rollHour(hs);
    const n = (this.hour.counts.get(place.key) || 0) + 1;
    this.hour.counts.set(place.key, n);
    const a = unusualTime(b, place.key, ev, place.name) || unusuallyBusy(b, place.key, ev.ts, n, place.name);
    if (a) this.anomaly(a, ev);
  }
  /** At the end of an hour: was a normally-busy place silent? (Only while someone is home.) */
  rollHour(nextStart) {
    const prev = this.hour;
    this.hour = { start: nextStart, counts: new Map() };
    if (!prev.start || this.hq.settings().mode !== 'home' || nextStart - prev.start !== HOUR) return;
    const b = this.ensureBaseline();
    for (const key of Object.keys(b.cells)) {
      const name = this.placeName(key);
      const a = missingActivity(b, key, prev.start, prev.counts.get(key) || 0, name);
      if (a) this.anomaly(a, null, prev.start + HOUR - 1);
    }
  }
  tick() { const hs = Math.floor(this.now() / HOUR) * HOUR; if (this.hour.start && hs !== this.hour.start) this.rollHour(hs); else if (!this.hour.start) this.hour.start = hs; }
  placeName(key) {
    if (key.startsWith('agent:')) { const a = this.db.agent(key.slice(6)); return a ? a.name || a.codename : 'an Agent'; }
    for (const f of this.hq.house().floors || []) { const r = f.rooms.find((x) => x.id === key); if (r) return r.name; }
    return 'a room';
  }
  anomaly(a, ev, ts = ev?.ts ?? this.now()) {
    const tag = `${a.key}|${a.type}|${a.hour}|${new Date(ts).toDateString()}`;
    if (this.flagged.has(tag)) return;
    this.flagged.add(tag);
    if (this.flagged.size > 2000) this.flagged = new Set([...this.flagged].slice(-500));
    const severity = a.type === 'quiet' ? 'LOW' : a.confidence >= 80 ? 'MEDIUM' : 'LOW';
    const rec = { id: `an-${ts}-${Math.random().toString(36).slice(2, 6)}`, ts, ...a, severity };
    this.db.putDoc('anomalies', rec, 500);
    this.hq.logEvent({ kind: 'anomaly', level: 'warn', message: `${a.title} (${a.confidence}% confidence) — ${a.reason}`, data: { type: a.type, confidence: a.confidence } });
    const isRoom = !a.key.startsWith('agent:');
    this.hq.ops.raise({ severity, title: a.title, explanation: `${a.reason} Confidence ${a.confidence}%.`, source: 'anomaly', kind: `anomaly:${a.type}`, agentId: ev?.agentId || null, roomId: isRoom ? a.key : null, room: isRoom ? this.placeName(a.key) : '', eventIds: ev ? [ev.id] : [], ts, data: { confidence: a.confidence } });
  }
  /** For the Pattern-of-life screen. */
  patterns() {
    const b = this.ensureBaseline();
    const places = Object.keys(b.cells).map((key) => ({ key, name: this.placeName(key), wd: profile(b, key, 'wd'), we: profile(b, key, 'we') }));
    return { daysObserved: b.daysObserved, learnDays: LEARN_DAYS, minDays: MIN_DAYS, learning: b.learning, observed: b.observed, places, anomalies: this.db.docs('anomalies').sort((x, y) => y.ts - x.ts).slice(0, 50) };
  }
}
