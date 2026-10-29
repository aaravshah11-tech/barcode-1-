// REPLAY + HEATMAP maths. Pure, unit tested.
import { ACTIVITY_KINDS } from './threat.js';

export const SPEEDS = [60, 300, 900, 3600]; // 1 min, 5 min, 15 min or 1 h of the day per second
export const HEAT_STEPS = 5;

/** The sensor events (motion, door, sound…) between from and to, oldest first. */
export function replayable(events, from, to) {
  return events.filter((e) => ACTIVITY_KINDS.has(e.kind) && e.ts >= from && e.ts <= to).sort((a, b) => a.ts - b.ts || a.id - b.id);
}

/** Index of the first event after time t (events sorted by ts). */
export function indexAfter(events, t) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].ts <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Which room each Agent is in → how many events each room had. Events from Agents not on the map are counted apart. */
export function roomCounts(events, agents, house) {
  const roomOf = new Map(agents.filter((a) => a.place?.roomId).map((a) => [a.id, a.place.roomId]));
  const valid = new Set((house?.floors || []).flatMap((f) => f.rooms.map((r) => r.id)));
  const counts = {};
  let unplaced = 0;
  for (const e of events) {
    if (!ACTIVITY_KINDS.has(e.kind)) continue;
    const r = roomOf.get(e.agentId);
    if (r && valid.has(r)) counts[r] = (counts[r] || 0) + 1; else unplaced++;
  }
  const max = Math.max(0, ...Object.values(counts));
  return { counts, unplaced, max, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** 0 for none, else 1…HEAT_STEPS (equal steps of the busiest room's count). */
export function heatLevel(n, max, steps = HEAT_STEPS) {
  if (!n || !max) return 0;
  return Math.max(1, Math.min(steps, Math.ceil((n / max) * steps)));
}
/** Fill strength for a level: quiet rooms faint, the busiest strong (one colour, light → strong). */
export const heatOpacity = (level) => (level ? [0, 0.14, 0.24, 0.34, 0.46, 0.6][level] : 0);

export const clockOf = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
