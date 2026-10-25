// Which events raise an alert, and quiet hours. Pure functions (unit tested).

/** Is "now" inside quiet hours? Handles ranges that cross midnight (22:00 → 07:00). */
export function inQuietHours(start, end, date = new Date()) {
  if (!start || !end || start === end) return false;
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const now = date.getHours() * 60 + date.getMinutes(), a = mins(start), b = mins(end);
  return a < b ? now >= a && now < b : now >= a || now < b;
}

const ACTIVITY = new Set(['motion', 'door', 'sound', 'light', 'knock']);
/** Which alert (if any) an event should raise. Pure, so it can be tested. */
export function ruleFor(ev, away) {
  if (ACTIVITY.has(ev.kind) && away) return { rule: 'awayMotion', title: '🔴 SENTINEL: THREAT RED', body: `${ev.message} — nobody’s home`, red: true };
  if (ev.kind === 'knock') return { rule: 'knock', title: '🔔 Someone’s at the door', body: ev.message };
  if (ev.kind === 'door' && /opened/i.test(ev.message)) return { rule: 'door', title: '🚪 Door opened', body: ev.message };
  if (ev.kind === 'sound') return { rule: 'sound', title: '🔊 Loud sound', body: ev.message };
  if (ev.kind === 'agent' && ev.level === 'warn' && /offline$/.test(ev.message)) return { rule: 'offline', title: '⚠ Agent offline', body: ev.message };
  return null;
}

