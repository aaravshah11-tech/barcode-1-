// ALERT GRADING: decides how serious something is from its context, before it reaches Triage.
// Order: built-in context (what was seen, where, the Alert State, the weather, what is normal at this hour)
// → your own grading rules (Administration › Rules) → snoozes. Every change is explained in plain English.
// Pure functions, unit tested.
import { SEVERITIES, SEV_LABEL, validSeverity } from './triage.js';

const up = (s, n = 1) => SEVERITIES[Math.min(3, SEVERITIES.indexOf(s) + n)];
const down = (s, n = 1) => SEVERITIES[Math.max(0, SEVERITIES.indexOf(s) - n)];
const mins = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** Is `ts` inside a daily window like 22:30–07:00? */
export function inWindow(ts, from, to) {
  const d = new Date(ts), t = d.getHours() * 60 + d.getMinutes(), a = mins(from), b = mins(to);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** Conditions a grading rule can test, and the actions it can take (the visual rule builder uses these). */
export const RULE_FIELDS = {
  kind: { label: 'What', options: [['', 'Anything'], ['motion', 'Motion'], ['door', 'Door'], ['sound', 'Loud sound'], ['light', 'Light change'], ['knock', 'Door panel'], ['perimeter', 'Perimeter (outside)'], ['tamper', 'Tamper'], ['agent', 'Agent health'], ['network', 'Network'], ['system', 'System']] },
  cls: { label: 'Recognised as', options: [['', 'Anything'], ['person', 'Person'], ['vehicle', 'Vehicle'], ['animal', 'Animal'], ['motion', 'Movement only']] },
  zone: { label: 'Where', options: [['', 'Anywhere'], ['inside', 'Inside'], ['front', 'Front / driveway'], ['garden', 'Garden'], ['garage', 'Garage / shed']] },
};
export const RULE_ACTIONS = [['set', 'Set severity to'], ['raise', 'Raise one level'], ['lower', 'Lower one level'], ['suppress', 'Don’t raise an alert (log only)']];

/** Clean a grading rule from the builder. */
export function cleanGradeRule(r = {}) {
  const pick = (k) => (RULE_FIELDS[k].options.some(([v]) => v === r.when?.[k]) ? r.when[k] : '');
  const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
  const time = (v) => (/^\d\d:\d\d$/.test(v || '') ? v : '');
  return {
    id: str(r.id, 64) || `grade-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: str(r.name, 60) || 'Untitled rule',
    enabled: r.enabled !== false,
    when: {
      kind: pick('kind'), cls: pick('cls'), zone: pick('zone'), room: str(r.when?.room, 40),
      modes: (Array.isArray(r.when?.modes) ? r.when.modes : []).filter((m) => ['home', 'away', 'night', 'lockdown'].includes(m)),
      from: time(r.when?.from), to: time(r.when?.to),
    },
    then: { action: RULE_ACTIONS.some(([a]) => a === r.then?.action) ? r.then.action : 'set', severity: validSeverity(r.then?.severity || 'ADVISORY') },
  };
}

/** Does a grading rule apply to this alert? a = { kind, cls, zone, room }, ctx = { mode, now } */
export function ruleMatches(rule, a, ctx) {
  const w = rule.when;
  if (!rule.enabled) return false;
  if (w.kind && w.kind !== a.kind) return false;
  if (w.cls && w.cls !== a.cls) return false;
  if (w.zone && w.zone !== (a.zone || 'inside')) return false;
  if (w.room && w.room.toLowerCase() !== String(a.room || '').toLowerCase()) return false;
  if (w.modes.length && !w.modes.includes(ctx.mode)) return false;
  if (w.from && w.to && !inWindow(ctx.now, w.from, w.to)) return false;
  return true;
}
/** Plain-English summary of a rule ("Animal · Garden → Info"). */
export function describeRule(r) {
  const w = r.when, opt = (k) => RULE_FIELDS[k].options.find(([v]) => v === w[k])?.[1];
  const parts = [w.kind && opt('kind'), w.cls && opt('cls'), w.zone && opt('zone'), w.room && `in ${w.room}`, w.modes.length && `when ${w.modes.map((m) => m.toUpperCase()).join('/')}`, w.from && w.to && `${w.from}–${w.to}`].filter(Boolean);
  const act = r.then.action === 'set' ? SEV_LABEL[r.then.severity] : r.then.action === 'raise' ? 'one level up' : r.then.action === 'lower' ? 'one level down' : 'log only';
  return `${parts.join(' · ') || 'Everything'} → ${act}`;
}

/** A snooze covers this alert? s = { scope: 'agent'|'title'|'kind', value, until } */
export const snoozeMatches = (s, a, now) => now < s.until && ((s.scope === 'agent' && a.agentId === s.value) || (s.scope === 'title' && a.title === s.value) || (s.scope === 'kind' && a.kind === s.value));

/**
 * Grade an alert. a = { severity, kind, cls, zone, room, agentId, title, source }.
 * ctx = { mode, now, windMph, expected (the pattern of life says this is normal now), rules, snoozes, recentFailedLogins }.
 * Returns { severity, suppressed, snoozedBy, reasons }.
 */
export function grade(a, ctx) {
  let sev = validSeverity(a.severity);
  const reasons = [];
  const set = (s, why) => { if (s !== sev) { reasons.push(`${why} (${SEV_LABEL[sev]} → ${SEV_LABEL[s]})`); sev = s; } };
  const occupied = ctx.mode === 'home';
  const outside = a.zone && a.zone !== 'inside';

  // --- built-in context ---
  if (a.kind === 'perimeter') {
    if (a.cls === 'animal') set('INFO', 'Only an animal');
    else if (a.cls === 'vehicle' && occupied) set('INFO', 'A vehicle while someone is home');
    else if (a.cls === 'person' && occupied && a.zone === 'front' && !inWindow(ctx.now, '23:00', '06:00')) set('ADVISORY', 'Someone at the front while you’re home — probably a visitor or delivery');
    else if (a.cls === 'person' && (ctx.mode === 'night' || inWindow(ctx.now, '23:00', '06:00')) && sev !== 'CRITICAL') set(SEVERITIES.indexOf(sev) < 2 ? 'ALERT' : sev, `A person ${a.zone === 'garden' ? 'in the garden' : 'outside'} at night`);
  }
  if (outside && (a.cls === 'motion' || a.kind === 'motion') && ctx.windMph >= 25 && sev !== 'CRITICAL') set(down(sev), `Windy (${Math.round(ctx.windMph)} mph) — outside movement is often branches or bins`);
  if (occupied && ctx.expected && ['motion', 'door', 'sound', 'light'].includes(a.kind) && sev !== 'CRITICAL') set(down(sev), 'Normal for this time of day (pattern of life)');
  if (a.kind === 'agent' && /battery/i.test(a.title || '')) set(/critical/i.test(a.title) ? 'ALERT' : 'ADVISORY', 'An Agent is about to stop working');
  if (/^Failed sign-in/.test(a.title || '') && ctx.recentFailedLogins >= 3) set('ALERT', `${ctx.recentFailedLogins} failed sign-ins in 10 minutes`);

  // --- your rules, in order ---
  let suppressed = false;
  for (const r of ctx.rules || []) {
    if (!ruleMatches(r, a, ctx)) continue;
    if (r.then.action === 'suppress') { suppressed = true; reasons.push(`Your rule “${r.name}”: log only`); continue; }
    const target = r.then.action === 'set' ? r.then.severity : r.then.action === 'raise' ? up(sev) : down(sev);
    set(target, `Your rule “${r.name}”`);
  }
  // CRITICAL from PANIC / LOCKDOWN is never suppressed or snoozed
  const sz = (ctx.snoozes || []).find((s) => snoozeMatches(s, a, ctx.now));
  if (a.severity === 'CRITICAL') { suppressed = false; if (sev !== 'CRITICAL') set('CRITICAL', 'Critical alerts can’t be lowered'); return { severity: sev, suppressed, snoozedBy: null, reasons }; }
  return { severity: sev, suppressed: suppressed || !!sz, snoozedBy: sz || null, reasons };
}

/** Quiet hours: should this alert make a sound / notification now? Critical always does. */
export function shouldNotify(severity, { now, quiet, onWatch = false }) {
  if (severity === 'CRITICAL') return true;
  if (quiet?.on && inWindow(now, quiet.from, quiet.to)) return false;
  return severity === 'ALERT' || (onWatch && severity === 'ADVISORY');
}
