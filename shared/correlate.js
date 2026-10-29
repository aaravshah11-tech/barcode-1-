// CORRELATION ENGINE: editable rules that turn a short sequence of separate signals into one
// conclusion, e.g. "front door opened → hall motion → a known phone connected, within 60 s = ARRIVAL".
// Pure logic (no storage, no network) so it can be tested on its own.

/** Signals a rule step can wait for. "device" = a linked phone/known device appearing (Network register). */
export const SIGNALS = [
  ['door', 'Door sensor'], ['motion', 'Motion'], ['sound', 'Loud sound'], ['light', 'Light change'], ['knock', 'Door panel pressed'],
  ['device', 'Phone / device appears'], ['agent', 'Agent online/offline'],
];
const SIGNAL_KEYS = new Set(SIGNALS.map(([k]) => k));
export const RESULT_LEVELS = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const ALL_MODES = ['home', 'away', 'night', 'lockdown'];

const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

/** Clean a rule from the editor (anything odd is dropped or clamped). */
export function cleanRule(r = {}) {
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, 6).map((s) => ({
    signal: SIGNAL_KEYS.has(s?.signal) ? s.signal : 'motion',
    roomId: s?.roomId ? str(s.roomId, 64) : null,
    agentId: s?.agentId ? str(s.agentId, 64) : null,
    text: str(s?.text, 40),
  }));
  return {
    id: str(r.id, 64) || `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: str(r.name, 60) || 'Untitled rule',
    enabled: r.enabled !== false,
    windowSec: Math.min(3600, Math.max(5, Math.round(Number(r.windowSec) || 60))),
    ordered: r.ordered !== false,
    steps: steps.length ? steps : [{ signal: 'motion', roomId: null, agentId: null, text: '' }],
    label: str(r.label, 30).toUpperCase() || 'MATCH',
    likely: str(r.likely, 40),
    level: RESULT_LEVELS.includes(r.level) ? r.level : 'INFO',
    modes: (Array.isArray(r.modes) ? r.modes : ALL_MODES).filter((m) => ALL_MODES.includes(m)),
  };
}

/** The example rules a new HQ starts with (they can be edited, switched off or deleted). */
export const DEFAULT_RULES = [
  cleanRule({ id: 'rule-arrival', name: 'Arrival', windowSec: 60, ordered: true, label: 'ARRIVAL', likely: '', level: 'INFO', modes: ALL_MODES,
    steps: [{ signal: 'door', text: 'open' }, { signal: 'motion' }, { signal: 'device' }] }),
  cleanRule({ id: 'rule-intrusion', name: 'Entry while unoccupied', windowSec: 45, ordered: true, label: 'INTRUSION SEQUENCE', level: 'CRITICAL', modes: ['away', 'lockdown'],
    steps: [{ signal: 'door', text: 'open' }, { signal: 'motion' }] }),
];

/** Does one event satisfy one step? ctx.roomOf(agentId) → roomId | null */
export function matchStep(step, ev, ctx = {}) {
  if (!ev) return false;
  if (step.signal === 'device') { if (ev.kind !== 'device') return false; }
  else if (step.signal === 'agent') { if (ev.kind !== 'agent' || !/\b(online|offline)\b/.test(ev.message || '')) return false; }
  else if (ev.kind !== step.signal) return false;
  if (step.agentId && ev.agentId !== step.agentId) return false;
  if (step.roomId && (ctx.roomOf?.(ev.agentId) ?? null) !== step.roomId) return false;
  if (step.text && !String(ev.message || '').toLowerCase().includes(step.text.toLowerCase())) return false;
  return true;
}

/**
 * Find events (from `recent`, oldest first) that complete the rule, the last one being `ev`.
 * Ordered rules need the steps in that order; unordered ones in any order. Returns events or null.
 */
export function completes(rule, recent, ev, ctx = {}) {
  const from = ev.ts - rule.windowSec * 1000;
  const pool = recent.filter((e) => e.ts >= from && e.ts <= ev.ts && e.id !== ev.id);
  const n = rule.steps.length;
  // `ev` must fill one of the steps (the last one for an ordered rule)
  const evSlots = rule.ordered ? [n - 1] : rule.steps.map((_, i) => i);
  for (const slot of evSlots) {
    if (!matchStep(rule.steps[slot], ev, ctx)) continue;
    const used = new Set([ev.id]), picked = new Array(n);
    picked[slot] = ev;
    let ok = true;
    if (rule.ordered) {
      let after = from - 1;
      for (let i = 0; i < n - 1 && ok; i++) {
        const e = pool.find((x) => x.ts >= after && !used.has(x.id) && matchStep(rule.steps[i], x, ctx));
        if (!e) ok = false; else { picked[i] = e; used.add(e.id); after = e.ts; }
      }
    } else {
      for (let i = 0; i < n && ok; i++) {
        if (i === slot) continue;
        const e = [...pool].reverse().find((x) => !used.has(x.id) && matchStep(rule.steps[i], x, ctx));
        if (!e) ok = false; else { picked[i] = e; used.add(e.id); }
      }
    }
    if (ok) return picked;
  }
  return null;
}

/**
 * Keeps a short memory of recent events and checks every rule as each event arrives.
 * feed(ev, { mode, roomOf, ownerOf }) → [{ rule, events, likely, seconds }]
 */
export class Correlator {
  constructor(rules = []) { this.rules = rules; this.recent = []; this.cooldown = new Map(); }
  setRules(rules) { this.rules = rules; }
  feed(ev, ctx = {}) {
    if (!ev || ev.kind === 'correlation' || ev.kind === 'anomaly' || ev.kind === 'triage') return [];
    const longest = Math.max(60, ...this.rules.map((r) => r.windowSec)) * 1000;
    this.recent = this.recent.filter((e) => e.ts >= ev.ts - longest);
    const out = [];
    for (const rule of this.rules) {
      if (!rule.enabled || (ctx.mode && !rule.modes.includes(ctx.mode))) continue;
      if ((this.cooldown.get(rule.id) || 0) > ev.ts) continue;
      const events = completes(rule, this.recent, ev, ctx);
      if (!events) continue;
      this.cooldown.set(rule.id, ev.ts + rule.windowSec * 1000);
      const device = events.find((e) => e.kind === 'device');
      const likely = rule.likely || ctx.ownerOf?.(device) || '';
      out.push({ rule, events, likely, seconds: Math.round((events.at(-1).ts - Math.min(...events.map((e) => e.ts))) / 1000) });
    }
    this.recent.push(ev);
    return out;
  }
}

/** One line describing a match: "ARRIVAL (likely: Mum) — Door opened → Motion → Phone connected in 42 s". */
export function describeMatch(m, short = (e) => String(e.message || e.kind).replace(/^AGENT-\d+ [A-Z0-9 _-]+: /, '')) {
  return `${m.rule.label}${m.likely ? ` (likely: ${m.likely})` : ''} — ${m.events.map(short).join(' → ')} in ${m.seconds} s`;
}
