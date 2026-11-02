// THE ANALYST (HQ's side). Talks to a language model running on your own computer (Ollama), gives it
// READ-ONLY tools over SENTINEL's records, checks that every reference it cites exists, and turns its
// suggestions into buttons you must press. It can't change anything itself (non-negotiable rule 5).
// Every 15 minutes it writes the Current Picture; at 07:00 the morning SITREP. With no model available,
// SENTINEL writes the same things automatically from the evidence (marked "automatic").
import { SYSTEM_PROMPT, TOOLS, TOOL_NAMES, checkAnswer, parseSearch, runSearch, describeSearch, autoPicture, autoTuning, clockOf, shortMsg } from '../../shared/analyst.js';
import { zoneOf } from '../../shared/perimeter.js';
import { validSeverity, SEV_RANK } from '../../shared/triage.js';

const MIN = 60000, H = 60 * MIN;
const fail = (status, message) => Object.assign(new Error(message), { status });
/** The model must run on this computer or your own home network — never a service on the internet. */
export function localUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    const h = x.hostname.replace(/^\[|\]$/g, '');
    return /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/i.test(h);
  } catch { return false; }
}

export class Analyst {
  constructor({ hq, db }) {
    this.hq = hq; this.db = db;
    this.fetch = (...a) => globalThis.fetch(...a); // replaced in the tests
    this.state = { ok: false, models: [], checkedAt: 0, error: 'Not checked yet' };
  }
  start() { this.timer = setInterval(() => this.tick().catch(() => {}), MIN); this.first = setTimeout(() => this.tick().catch(() => {}), 20000); return this; }
  stop() { clearInterval(this.timer); clearTimeout(this.first); }
  cfg() { return { on: false, url: 'http://localhost:11434', model: '', voice: false, ...(this.hq.settings().analyst || {}) }; }

  async call(path, body, ms = 120000) {
    const c = this.cfg();
    if (!localUrl(c.url)) throw fail(400, 'The Analyst’s address must be on this computer or your home network.');
    const ctl = new AbortController(), kill = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await this.fetch(`${c.url.replace(/\/$/, '')}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal });
      if (!r.ok) throw new Error(`the model service said ${r.status}`);
      return await r.json();
    } catch (e) {
      throw fail(502, e.name === 'AbortError' ? 'The model took too long to answer.' : /fetch|network|load/i.test(e.message) ? 'Can’t reach Ollama on this computer. Is it running, and is OLLAMA_ORIGINS set? (Analyst › Set up)' : e.message);
    } finally { clearTimeout(kill); }
  }
  /** Is the local model reachable, and which models are installed? */
  async status(force = false) {
    const c = this.cfg();
    if (!c.on) return { ...this.state, on: false, ok: false, error: 'Switched off', model: c.model, url: c.url };
    if (!force && Date.now() - this.state.checkedAt < MIN) return { ...this.state, on: true, model: c.model, url: c.url };
    try {
      const j = await this.call('/api/tags', null, 4000);
      const models = (j.models || []).map((m) => m.name).filter(Boolean);
      this.state = { ok: !!models.length, models, checkedAt: Date.now(), error: models.length ? '' : 'Ollama is running but no model is installed (ollama pull llama3.1:8b).' };
    } catch (e) { this.state = { ok: false, models: [], checkedAt: Date.now(), error: e.message }; }
    return { ...this.state, on: true, model: c.model || this.state.models[0] || '', url: c.url };
  }

  // ---------- read-only tools ----------
  tool(name, args = {}) {
    const hq = this.hq, now = hq.now();
    const snap = hq.snapshot();
    const evt = (e) => ({ ref: `EVT-${e.id}`, time: clockOf(e.ts), day: new Date(e.ts).toDateString().slice(0, 10), kind: e.kind, message: shortMsg(e.message), class: e.data?.class, zone: this.zoneOfEvent(e, snap.agents) });
    if (name === 'get_situation') {
      const open = hq.ops.alerts({ status: 'new' }).filter((a) => a.severity !== 'INFO');
      const w = hq.weather;
      return { now: clockOf(now), alert_state: snap.settings.mode.toUpperCase(), threat: snap.threat?.level, agents_online: snap.agents.filter((a) => a.online).map((a) => a.codename), agents_offline: snap.agents.filter((a) => !a.online).map((a) => a.codename), unhandled_alerts: open.length, worst_unhandled: open.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0]?.id || null, weather: w ? `${w.text}, ${w.temp}°C, wind ${w.wind} mph${w.rainIn != null ? `, rain in ${w.rainIn} min` : ''}` : 'unknown' };
    }
    if (name === 'get_alerts') {
      const since = now - Math.min(168, Math.max(1, Number(args.hours) || 24)) * H, min = SEV_RANK[validSeverity(args.min_severity || 'INFO')];
      return hq.ops.alerts({ limit: 400 }).filter((a) => a.ts >= since && SEV_RANK[a.severity] >= min).slice(0, 30)
        .map((a) => ({ ref: a.id, time: clockOf(a.ts), severity: a.severity, title: a.title, room: a.room || a.zone || '', status: a.status, repeats: a.count, why: a.explanation?.slice(0, 160) || '' }));
    }
    if (name === 'search_log') {
      const f = { hours: Math.min(168, Math.max(0.25, Number(args.hours) || 24)), kind: args.kind || null, zone: args.zone || null, class: args.class || null, text: args.text ? String(args.text).toLowerCase().slice(0, 40) : null, from: null, to: null };
      return this.search(f).slice(0, 40).map(evt);
    }
    if (name === 'get_incident') {
      const d = hq.ops.incidentDetail(String(args.ref || ''));
      return { ref: d.incident.ref, title: d.incident.title, severity: d.incident.severity, status: d.incident.status, opened: clockOf(d.incident.createdAt), alerts: d.alerts.map((a) => ({ ref: a.id, title: a.title, time: clockOf(a.ts) })), notes: d.incident.notes.map((n) => n.text).slice(-5), timeline: d.timeline.slice(-25).map((x) => ({ time: clockOf(x.ts), text: shortMsg(x.text) })) };
    }
    if (name === 'get_fleet') return hq.fleet.rows().map((a) => ({ agent: `${a.label} ${a.codename}`, mission: a.missionName, online: a.online, battery: a.battery != null ? `${Math.round(a.battery * 100)}%` : 'n/a', health: a.health.score, problems: a.health.notes }));
    if (name === 'get_patterns') {
      const f = hq.ops.fatigue();
      return { anomalies: this.db.docs('anomalies').sort((a, b) => b.ts - a.ts).slice(0, 8).map((a) => ({ time: clockOf(a.ts), title: a.title, reason: a.reason, confidence: a.confidence })), alert_load: { per_day: f.perDay, false_alarm_percent: f.falseRate, noisy: f.sources.filter((s) => s.noisy).map((s) => s.advice) } };
    }
    throw fail(400, `Unknown tool ${name}`);
  }
  zoneOfEvent(e, agents) { return e.data?.zone || zoneOf(agents.find((a) => a.id === e.agentId), this.hq.house()) || null; }
  search(f) {
    const now = this.hq.now(), agents = this.hq.snapshot().agents;
    const from = f.from ?? now - f.hours * H;
    const events = this.db.events({ since: from, limit: 20000 });
    return runSearch(events, f, { now, zoneOf: (e) => this.zoneOfEvent(e, agents), roomOf: (e) => this.hq.ops.roomOf(e.agentId).room });
  }

  // ---------- asking ----------
  /** Plain-English search of the log (no model needed). */
  plainSearch(q) {
    const f = parseSearch(q, this.hq.now());
    const hits = this.search(f);
    return { understood: describeSearch(f), filter: f, count: hits.length, results: hits.slice(0, 100).map((e) => ({ ref: `EVT-${e.id}`, ts: e.ts, kind: e.kind, level: e.level, message: e.message })) };
  }
  /**
   * Ask the Analyst. kind: 'question' | 'picture' | 'sitrep' | 'incident' | 'anomaly' | 'tuning'.
   * Returns { text, refs, proposals, model, auto, ms }.
   */
  async ask(q, { kind = 'question', ref = null } = {}) {
    const t0 = Date.now(), c = this.cfg();
    const prompt = this.promptFor(kind, q, ref);
    const st = c.on ? await this.status() : { ok: false, error: 'Switched off' };
    if (!st.ok) return { ...this.automatic(kind, q, ref), auto: true, reason: st.error, ms: Date.now() - t0 };
    const model = c.model || st.models[0];
    const seen = new Set();
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }];
    const used = [];
    let answer = '';
    for (let round = 0; round < 6; round++) {
      const r = await this.call('/api/chat', { model, messages, tools: TOOLS.map((f) => ({ type: 'function', function: f })), stream: false, options: { temperature: 0.2 } });
      const msg = r.message || {};
      if (msg.tool_calls?.length) {
        messages.push(msg);
        for (const call of msg.tool_calls.slice(0, 4)) {
          const name = call.function?.name;
          let args = call.function?.arguments || {};
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
          let out;
          try { out = TOOL_NAMES.has(name) ? this.tool(name, args) : { error: `There is no tool called ${name}.` }; } catch (e) { out = { error: e.message }; }
          const text = JSON.stringify(out).slice(0, 8000);
          for (const m of text.match(/\b(ALT-\d{6}|INC-\d{4}-\d{4}|EVT-\d+)\b/g) || []) seen.add(m);
          used.push(name);
          messages.push({ role: 'tool', tool_name: name, content: text });
        }
        continue;
      }
      answer = msg.content || '';
      break;
    }
    if (!answer) return { ...this.automatic(kind, q, ref), auto: true, reason: 'The model gave no answer.', ms: Date.now() - t0 };
    const known = (r) => seen.has(r) || (/^ALT-/.test(r) && !!this.db.doc('alerts', r)) || (/^INC-/.test(r) && this.db.docs('incidents').some((i) => i.ref === r));
    const chk = checkAnswer(answer, known);
    let text = chk.text;
    for (const u of chk.unknown) text = text.split(u).join('unverified');
    return { text, refs: chk.refs, unknown: chk.unknown, proposals: chk.proposals, cited: chk.cited, model, tools: used, auto: false, ms: Date.now() - t0 };
  }
  promptFor(kind, q, ref) {
    if (kind === 'picture') return 'Write the Current Picture: two or three sentences on the situation right now and the last four hours. Use get_situation and get_alerts first.';
    if (kind === 'sitrep') return 'Write this morning’s SITREP for the last 12 hours (overnight): situation, notable activity, alerts and what was done, equipment problems, and anything I should do today. Use the tools. Under 200 words, short numbered sections.';
    if (kind === 'incident') return `Summarise incident ${ref} for the record: what happened, in time order, what was done, what is still open. Use get_incident.`;
    if (kind === 'anomaly') return `Explain alert ${ref} in plain terms: why it was unusual, what normally happens at that time, and whether it needs action. Use get_alerts and get_patterns.`;
    if (kind === 'tuning') return 'Give tuning advice: which Agents or rules cause most alerts or false alarms, and one concrete change for each. Use get_patterns and get_fleet.';
    return String(q || '').slice(0, 500);
  }
  /** The same jobs without a model: plain summaries from the evidence. */
  automatic(kind, q, ref) {
    const hq = this.hq, snap = hq.snapshot(), now = hq.now();
    const base = { mode: snap.settings.mode, threat: snap.threat, alerts: hq.ops.alerts({ limit: 400 }), agents: snap.agents, weather: hq.weather, events: this.db.events({ since: now - 4 * H, limit: 500 }), now };
    const wrap = (text) => ({ text, refs: [...new Set(text.match(/\b(ALT-\d{6}|INC-\d{4}-\d{4}|EVT-\d+)\b/g) || [])], proposals: [], model: null });
    if (kind === 'picture') return wrap(autoPicture(base));
    if (kind === 'sitrep') {
      const night = this.db.events({ since: now - 12 * H, limit: 5000 });
      const al = base.alerts.filter((a) => a.ts >= now - 12 * H && a.severity !== 'INFO');
      return wrap([`1. Situation: ${autoPicture(base)}`, `2. Overnight: ${night.filter((e) => ['motion', 'door', 'perimeter', 'knock', 'sound'].includes(e.kind)).length} sensor events, ${al.length} alert${al.length === 1 ? '' : 's'}${al.length ? ` (${al.slice(0, 3).map((a) => `${a.title} [${a.id}]`).join('; ')})` : ''}.`,
        `3. Equipment: ${snap.agents.filter((a) => !a.online).length} Agent(s) offline, ${snap.agents.filter((a) => a.battery != null && a.battery < 0.2 && !a.charging).length} low on battery.`].join('\n'));
    }
    if (kind === 'incident') {
      try {
        const d = hq.ops.incidentDetail(ref);
        return wrap(`${d.incident.ref} “${d.incident.title}” — ${d.incident.status}, ${d.incident.severity}. ${d.alerts.length} alert${d.alerts.length === 1 ? '' : 's'}: ${d.alerts.map((a) => `${a.title} at ${clockOf(a.ts)} [${a.id}]`).join('; ') || 'none'}. ${d.incident.notes.length} note${d.incident.notes.length === 1 ? '' : 's'}. Last update ${clockOf(d.incident.updatedAt)}.`);
      } catch (e) { return wrap(e.message); }
    }
    if (kind === 'anomaly') { const a = this.db.doc('alerts', ref); return wrap(a ? `${a.title} [${a.id}]: ${a.explanation || 'No further detail recorded.'}` : 'No such alert.'); }
    if (kind === 'tuning') return wrap(autoTuning(hq.ops.fatigue()));
    const s = this.plainSearch(q);
    return wrap(`Searched for ${s.understood}: ${s.count} match${s.count === 1 ? '' : 'es'}.${s.results.slice(0, 5).map((e) => ` ${clockOf(e.ts)} ${shortMsg(e.message)} [${e.ref}].`).join('')}`);
  }

  // ---------- stored notes, schedules ----------
  note(kind, r) {
    const doc = { id: `an-${this.hq.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: this.hq.now(), kind, text: r.text, refs: r.refs || [], proposals: r.proposals || [], model: r.model || null, auto: !!r.auto, reason: r.reason || '' };
    this.db.putDoc('analyst', doc, 200);
    this.hq.broadcast({ t: 'analyst', note: doc });
    return doc;
  }
  notes(kind = null) { return this.db.docs('analyst').filter((n) => !kind || n.kind === kind).sort((a, b) => b.ts - a.ts).slice(0, 50); }
  latest(kind) { return this.notes(kind)[0] || null; }
  async picture() { return this.note('picture', await this.ask('', { kind: 'picture' })); }
  async tick() {
    const now = this.hq.now(), last = this.latest('picture');
    if (!last || now - last.ts >= 15 * MIN) await this.picture();
    const d = new Date(now), key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (d.getHours() >= 7 && d.getHours() < 12 && this.db.getSetting('analystSitrep', null) !== key) {
      this.db.setSetting('analystSitrep', key);
      const n = this.note('sitrep', await this.ask('', { kind: 'sitrep' }));
      this.hq.logEvent({ kind: 'analyst', message: `Morning SITREP written${n.auto ? ' (automatic — no model)' : ` by ${n.model}`}` });
    }
  }
}
