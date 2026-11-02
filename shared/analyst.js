// THE ANALYST: rules and helpers shared by HQ and the tests. The language model runs on your own computer
// (Ollama); it can only READ through the tools below, must cite evidence by reference (ALT-000123,
// INC-2026-0004, EVT-5531), and can only PROPOSE changes — you press the button to carry them out.
// Without a model, SENTINEL still writes plain automatic summaries from the same evidence.

export const ANALYST_NAME = 'the Analyst';

export const SYSTEM_PROMPT = `You are the Analyst for SENTINEL, a private household security system run by one person (callsign FIRST DESK).
Write in calm, plain British English, like a duty officer's briefing: short sentences, no drama, no jokes, no Americanisms.
Rules you must follow:
1. Only state facts you got from the tools. Every factual sentence ends with its evidence in square brackets, e.g. [ALT-000412] or [EVT-5531] or [INC-2026-0004]. If you have no evidence, say "I have no evidence of that."
2. You can only read. You cannot change anything. If something should be done, add a line at the end starting "PROPOSE:" followed by one of: mode home|away|night|lockdown, acknowledge ALT-xxxxxx, open-incident ALT-xxxxxx. The operator decides.
3. Never invent Agents, rooms, times or references. Times are local, 24-hour (e.g. 23:41).
4. Camera pictures and sound never reach HQ; never suggest you can see or hear anything.
5. Keep answers under 120 words unless asked for a full report.`;

/** The read-only tools offered to the model (Ollama / OpenAI-style function schema). */
export const TOOLS = [
  { name: 'get_situation', description: 'Current Alert State, threat level, Agents online/offline, unhandled alerts count, weather.', parameters: { type: 'object', properties: {} } },
  { name: 'get_alerts', description: 'Triage alerts in the last N hours, newest first.', parameters: { type: 'object', properties: { hours: { type: 'number' }, min_severity: { type: 'string', enum: ['INFO', 'ADVISORY', 'ALERT', 'CRITICAL'] } } } },
  { name: 'search_log', description: 'Search the event log. All filters optional.', parameters: { type: 'object', properties: { hours: { type: 'number' }, kind: { type: 'string', description: 'motion, door, sound, light, knock, perimeter, tamper, agent, network, system' }, zone: { type: 'string', enum: ['inside', 'front', 'garden', 'garage'] }, text: { type: 'string' }, class: { type: 'string', enum: ['person', 'vehicle', 'animal'] } } } },
  { name: 'get_incident', description: 'One incident with its alerts, notes and timeline.', parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } },
  { name: 'get_fleet', description: 'Every Agent: mission, place, battery, online, health score.', parameters: { type: 'object', properties: {} } },
  { name: 'get_patterns', description: 'Recent anomalies from the pattern of life, and alert-load (fatigue) statistics per source.', parameters: { type: 'object', properties: {} } },
];
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/** Evidence references in a text. */
export const REF_RE = /\b(ALT-\d{6}|INC-\d{4}-\d{4}|EVT-\d+)\b/g;
export const refsIn = (text) => [...new Set(String(text || '').match(REF_RE) || [])];

/**
 * Check the model's answer: references that don't exist are marked, PROPOSE lines become buttons.
 * known(ref) → boolean. Returns { text, refs, unknown, proposals }.
 */
export function checkAnswer(text, known) {
  const lines = String(text || '').split('\n');
  const proposals = [];
  const body = lines.filter((l) => {
    const m = /^\s*PROPOSE:\s*(.+)$/i.exec(l);
    if (!m) return true;
    const p = parseProposal(m[1]);
    if (p && !proposals.some((x) => x.label === p.label)) proposals.push(p);
    return false;
  }).join('\n').trim();
  const refs = refsIn(body), unknown = refs.filter((r) => !known(r));
  return { text: body, refs: refs.filter((r) => known(r)), unknown, proposals: proposals.filter((p) => !p.ref || known(p.ref)), cited: refs.length > 0 };
}
export function parseProposal(s) {
  const t = String(s).trim();
  let m = /^mode\s+(home|away|night|lockdown)\b/i.exec(t);
  if (m) return { action: 'mode', value: m[1].toLowerCase(), label: `Switch to ${m[1].toUpperCase()}` };
  m = /^acknowledge\s+(ALT-\d{6})/i.exec(t);
  if (m) return { action: 'acknowledge', ref: m[1].toUpperCase(), label: `Acknowledge ${m[1].toUpperCase()}` };
  m = /^open-incident\s+(ALT-\d{6})/i.exec(t);
  if (m) return { action: 'incident', ref: m[1].toUpperCase(), label: `Open an incident from ${m[1].toUpperCase()}` };
  return null;
}

/**
 * Plain-English search → log filter, without a model. "people in the garden last night", "door yesterday",
 * "motion in the last 3 hours", "anything at the front today".
 */
export function parseSearch(q, now = Date.now()) {
  const s = String(q || '').toLowerCase();
  const f = { hours: 24, kind: null, zone: null, class: null, text: null, from: null, to: null };
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const H = 3600000;
  let m;
  if ((m = /last (\d+) (hour|hr|minute|min|day)s?/.exec(s))) f.hours = Number(m[1]) * (/day/.test(m[2]) ? 24 : /min/.test(m[2]) ? 1 / 60 : 1);
  else if (/last night|overnight/.test(s)) { f.from = d0.getTime() - 4 * H; f.to = d0.getTime() + 7 * H; if (now < f.to) { f.from -= 24 * H; f.to -= 24 * H; } }
  else if (/yesterday/.test(s)) { f.from = d0.getTime() - 24 * H; f.to = d0.getTime(); }
  else if (/today|this morning/.test(s)) { f.from = d0.getTime(); f.to = now; }
  else if (/this week|last week|7 days/.test(s)) f.hours = 168;
  if (/\b(people|person|someone|somebody|visitor|anyone)\b/.test(s)) { f.kind = 'perimeter'; f.class = 'person'; }
  else if (/\b(car|cars|vehicle|van)\b/.test(s)) { f.kind = 'perimeter'; f.class = 'vehicle'; }
  else if (/\b(animal|cat|fox|dog|bird)s?\b/.test(s)) { f.kind = 'perimeter'; f.class = 'animal'; }
  else if (/\bdoor/.test(s)) f.kind = 'door';
  else if (/\b(motion|movement|moving)\b/.test(s)) f.kind = 'motion';
  else if (/\b(sound|noise|loud)\b/.test(s)) f.kind = 'sound';
  else if (/\b(light|lights)\b/.test(s)) f.kind = 'light';
  else if (/\b(tamper|moved|covered)\b/.test(s)) f.kind = 'tamper';
  else if (/\b(offline|battery|agent)\b/.test(s)) f.kind = 'agent';
  else if (/\b(network|wi-?fi|internet|device)\b/.test(s)) f.kind = 'network';
  if (/\b(front|driveway|porch)\b/.test(s)) f.zone = 'front';
  else if (/\b(garden|back yard|backyard|lawn|patio)\b/.test(s)) f.zone = 'garden';
  else if (/\b(garage|shed)\b/.test(s)) f.zone = 'garage';
  else if (/\binside|indoors|in the house\b/.test(s)) f.zone = 'inside';
  if ((m = /\b(?:in|at) the (kitchen|hall|hallway|lounge|living room|bedroom|landing|study|office|dining room|utility)\b/.exec(s))) f.text = m[1];
  return f;
}
/** Apply a parsed search to events. zoneOf(event) gives an event's zone. */
export function runSearch(events, f, { now = Date.now(), zoneOf = () => null, roomOf = () => '' } = {}) {
  const from = f.from ?? now - f.hours * 3600000, to = f.to ?? now;
  return events.filter((e) => e.ts >= from && e.ts <= to
    && (!f.kind || e.kind === f.kind || (f.kind === 'network' && ['network', 'device'].includes(e.kind)))
    && (!f.class || e.data?.class === f.class)
    && (!f.zone || zoneOf(e) === f.zone)
    && (!f.text || `${e.message} ${roomOf(e)}`.toLowerCase().includes(f.text)));
}
/** "people in the garden, last night (22:00–07:00)" — what the search understood, for the screen. */
export function describeSearch(f) {
  const what = f.class ? { person: 'people', vehicle: 'vehicles', animal: 'animals' }[f.class] : f.kind ? `${f.kind} events` : 'everything';
  const where = f.zone ? ` ${f.zone === 'inside' ? 'inside' : `in the ${f.zone === 'front' ? 'front / driveway' : f.zone}`}` : '';
  const room = f.text ? ` mentioning “${f.text}”` : '';
  const t = (x) => new Date(x).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const when = f.from ? `${t(f.from)} – ${t(f.to)}` : f.hours >= 24 ? `last ${Math.round(f.hours / 24)} day${f.hours >= 48 ? 's' : ''}` : `last ${f.hours >= 1 ? `${Math.round(f.hours)} h` : `${Math.round(f.hours * 60)} min`}`;
  return `${what}${where}${room}, ${when}`;
}

/** The automatic Current Picture (no model): a few cited sentences from the evidence. */
export function autoPicture({ mode, threat, alerts = [], agents = [], weather = null, events = [], now = Date.now() }) {
  const H = 3600000, out = [];
  const open = alerts.filter((a) => a.status === 'new' && a.severity !== 'INFO').sort((a, b) => b.ts - a.ts);
  const worst = ['CRITICAL', 'ALERT', 'ADVISORY'].map((s) => open.filter((a) => a.severity === s)).find((l) => l.length);
  out.push(`Alert State ${String(mode || 'home').toUpperCase()}; threat ${threat?.level || 'GREEN'}.`);
  if (worst) out.push(`${open.length} unhandled alert${open.length === 1 ? '' : 's'}, the most serious being “${worst[0].title}” at ${clockOf(worst[0].ts)} [${worst[0].id}].`);
  else out.push('Nothing is waiting in Triage.');
  const last = events.find((e) => ['motion', 'door', 'perimeter', 'knock', 'sound'].includes(e.kind) && now - e.ts < 4 * H);
  if (last) out.push(`Last activity: ${shortMsg(last.message)} at ${clockOf(last.ts)} [EVT-${last.id}].`);
  const off = agents.filter((a) => !a.online);
  if (off.length) out.push(`${off.length} Agent${off.length === 1 ? ' is' : 's are'} offline: ${off.slice(0, 3).map((a) => a.codename).join(', ')}.`);
  if (weather && (weather.wind >= 25 || weather.rainIn === 0)) out.push(`${weather.rainIn === 0 ? 'Raining' : `Windy (${weather.wind} mph)`} — outside movement is graded down.`);
  return out.join(' ');
}
export const clockOf = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const shortMsg = (m) => String(m || '').replace(/^AGENT-\d+ [^:]+: /, '');

/** Tuning advice without a model: from alert-load statistics. */
export function autoTuning(fatigue) {
  if (!fatigue?.total) return 'Too few alerts in the last week to suggest any tuning.';
  const noisy = fatigue.sources.filter((s) => s.noisy);
  const lines = [`${fatigue.total} alerts in 7 days (${fatigue.perDay} a day), ${fatigue.falseRate}% dismissed as false alarms.`];
  for (const s of noisy.slice(0, 3)) lines.push(s.advice);
  if (!noisy.length) lines.push('No single source stands out. No tuning needed.');
  return lines.join(' ');
}
