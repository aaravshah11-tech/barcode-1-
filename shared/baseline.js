// PATTERN OF LIFE: learns, over the last 2 weeks, when each room is normally active (hour by hour,
// weekdays and weekends separately), then flags what doesn't fit — with a confidence percentage
// and a plain-English reason. Pure logic: it only reads Mission Log events.
import { ACTIVITY_KINDS } from './threat.js';

export const LEARN_DAYS = 14; // look back this far
export const MIN_DAYS = 7; // don't flag anything until a week has been seen
const DAY = 86400000;
const isWeekend = (ts) => { const d = new Date(ts).getDay(); return d === 0 || d === 6; };
export const dayType = (ts) => (isWeekend(ts) ? 'we' : 'wd');
const midnight = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hourOf = (ts) => new Date(ts).getHours();
const pad = (h) => String(h).padStart(2, '0');

/**
 * events: Mission Log events (any order). keyOf(ev) → 'kitchen-room-id' | null (where it happened).
 * Uses whole days only, from LEARN_DAYS ago up to the start of today.
 */
export function buildBaseline(events, { now = Date.now(), keyOf, days = LEARN_DAYS } = {}) {
  const to = midnight(now), from = to - days * DAY;
  const act = events.filter((e) => ACTIVITY_KINDS.has(e.kind) && e.ts >= from && e.ts < to);
  const first = act.length ? Math.min(...act.map((e) => e.ts)) : to;
  const start = Math.max(from, midnight(first));
  const observed = { wd: 0, we: 0 };
  for (let t = start; t < to; t += DAY) observed[dayType(t + 3600000)]++; // +1 h: safe across clock changes
  // per key → day type → hour → Map(day → count)
  const per = new Map();
  for (const e of act) {
    const key = keyOf(e);
    if (!key) continue;
    if (!per.has(key)) per.set(key, { wd: Array.from({ length: 24 }, () => new Map()), we: Array.from({ length: 24 }, () => new Map()) });
    const day = midnight(e.ts), cell = per.get(key)[dayType(e.ts)][hourOf(e.ts)];
    cell.set(day, (cell.get(day) || 0) + 1);
  }
  const cells = {};
  for (const [key, v] of per) {
    cells[key] = {};
    for (const t of ['wd', 'we']) cells[key][t] = v[t].map((m) => { const c = [...m.values()]; return { days: c.length, total: c.reduce((a, b) => a + b, 0), sq: c.reduce((a, b) => a + b * b, 0) }; });
  }
  const daysObserved = observed.wd + observed.we;
  return { from: start, to, daysObserved, observed, cells, learning: daysObserved < MIN_DAYS };
}

/** How sure we can be, given how much history there is (0–1). */
export const sufficiency = (b) => Math.min(1, b.daysObserved / LEARN_DAYS);

/** Typical activity for a place at an hour: share of days active, mean and spread of the per-day count. */
export function hourStats(b, key, ts) {
  const t = dayType(ts), n = b.observed[t] || 0, c = b.cells[key]?.[t]?.[hourOf(ts)] || { days: 0, total: 0, sq: 0 };
  const mean = n ? c.total / n : 0, sd = n ? Math.sqrt(Math.max(0, c.sq / n - mean * mean)) : 0;
  return { n, daysActive: c.days, share: n ? c.days / n : 0, mean, sd, type: t };
}

const pct = (x) => Math.max(1, Math.min(99, Math.round(x * 100)));
const typeWord = (t, n) => (t === 'we' ? `weekend day${n === 1 ? '' : 's'}` : `weekday${n === 1 ? '' : 's'}`);

/** Activity at a time when this place is normally quiet. place = room name for the message. */
export function unusualTime(b, key, ev, place = 'this room') {
  if (b.learning) return null;
  const s = hourStats(b, key, ev.ts);
  if (s.n < 3 || s.share > 0.05) return null;
  const p = (s.daysActive + 0.5) / (s.n + 1); // smoothed chance of activity in this hour
  const confidence = pct((1 - p) * sufficiency(b));
  if (confidence < 50) return null;
  const h = hourOf(ev.ts);
  return {
    type: 'unusual-time', key, confidence, hour: h,
    title: `Unusual activity — ${place}`,
    reason: `${place} is normally quiet between ${pad(h)}:00 and ${pad((h + 1) % 24)}:00: activity on ${s.daysActive} of the last ${s.n} ${typeWord(s.type, s.n)}.`,
  };
}

/** Far more activity than usual in one hour. count = events so far this hour. */
export function unusuallyBusy(b, key, ts, count, place = 'this room') {
  if (b.learning) return null;
  const s = hourStats(b, key, ts);
  if (s.n < 3 || count < 5) return null;
  const z = (count - s.mean) / Math.max(1, s.sd);
  if (z < 3) return null;
  const h = hourOf(ts);
  return {
    type: 'busy', key, confidence: pct(Math.min(0.99, 0.5 + z / 20) * sufficiency(b)), hour: h,
    title: `Unusually busy — ${place}`,
    reason: `${count} events in ${place} this hour (${pad(h)}:00–${pad((h + 1) % 24)}:00); usually about ${s.mean.toFixed(1)}.`,
  };
}

/** A place that is almost always active in this hour had nothing (checked when the hour ends). */
export function missingActivity(b, key, hourStartTs, count, place = 'this room') {
  if (b.learning || count > 0) return null;
  const s = hourStats(b, key, hourStartTs);
  if (s.n < 5 || s.share < 0.9) return null;
  const h = hourOf(hourStartTs);
  return {
    type: 'quiet', key, confidence: pct(s.share * sufficiency(b)), hour: h,
    title: `Usual activity missing — ${place}`,
    reason: `No activity in ${place} between ${pad(h)}:00 and ${pad((h + 1) % 24)}:00, which is normally active (${s.daysActive} of the last ${s.n} ${typeWord(s.type, s.n)}).`,
  };
}

/** For the Pattern-of-life chart: the share of days each hour was active, per place. */
export function profile(b, key, type) {
  const n = b.observed[type] || 0;
  return Array.from({ length: 24 }, (_, h) => { const c = b.cells[key]?.[type]?.[h]; return n && c ? c.days / n : 0; });
}
