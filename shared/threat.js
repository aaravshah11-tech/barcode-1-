// Security modes and the threat level. Pure functions, unit tested.
//
//   HOME      someone's in: activity is noted (AMBER for a few minutes), nothing alarms
//   AWAY      nobody's in: any motion, door, sound, light or button press is an intrusion (RED)
//   NIGHT     everyone's asleep: Agents marked "armed at night" raise RED (e.g. downstairs,
//             front door); the others (e.g. bedrooms) only AMBER
//   LOCKDOWN  maximum alert: everything is RED, and Agents can sound the alarm
//
// Threat level:  GREEN all quiet · AMBER recent activity · RED an armed sensor went off

export const ACTIVITY_KINDS = new Set(['motion', 'door', 'sound', 'light', 'knock']);
export const MODES = ['home', 'away', 'night', 'lockdown'];
export const MODE_INFO = {
  home: { label: 'Home', summary: 'Occupied. Activity is logged; nothing raises an alarm.' },
  away: { label: 'Away', summary: 'Unoccupied. Any activity from any Agent is treated as an intrusion.' },
  night: { label: 'Night', summary: 'Occupants asleep. Agents armed for night raise an alarm; the rest are only logged.' },
  lockdown: { label: 'Lockdown', summary: 'Maximum alert. Every Agent is armed and can sound the alarm.' },
};
export const validMode = (m) => (MODES.includes(m) ? m : 'home');

/** Does this Agent's report count as an intrusion in this mode? */
export function isArmed(mode, agent = {}, kind = 'motion') {
  if (!ACTIVITY_KINDS.has(kind)) return false;
  if (mode === 'away' || mode === 'lockdown') return true;
  if (mode === 'night') return agent.nightArmed !== false;
  return false;
}

/** Returns { level, reason, away, at }. RED comes from "alert" events (armed sensors) in the last alertMin. */
export function computeThreat({ events = [], mode = 'home', now = Date.now(), activityMin = 5, alertMin = 15 } = {}) {
  mode = validMode(mode);
  const away = mode === 'away' || mode === 'lockdown';
  const recent = events.filter((e) => ACTIVITY_KINDS.has(e.kind) && now - e.ts <= Math.max(activityMin, alertMin) * 60000).sort((a, b) => b.ts - a.ts);
  const red = recent.find((e) => e.level === 'alert' && now - e.ts <= alertMin * 60000);
  if (red) return { level: 'RED', reason: `${red.message} — ${MODE_INFO[mode].label.toUpperCase()} mode`, away, at: red.ts, mode };
  const amber = recent.find((e) => now - e.ts <= activityMin * 60000);
  if (amber) return { level: 'AMBER', reason: amber.message, away, at: amber.ts, mode };
  return { level: 'GREEN', reason: { home: 'All quiet', away: 'All quiet · premises unoccupied', night: 'All quiet · night watch', lockdown: 'LOCKDOWN in force · no activity' }[mode], away, at: null, mode };
}

/** What HQ suggests switching to, if anything: NIGHT late in the evening, HOME in the morning, AWAY after a long quiet spell. */
export function suggestMode({ mode, now = new Date(), nightStart = '22:30', nightEnd = '07:00', lastActivity = null, quietHoursForAway = 3 }) {
  const mins = (s) => Number(String(s).slice(0, 2)) * 60 + Number(String(s).slice(3, 5));
  const t = now.getHours() * 60 + now.getMinutes(), a = mins(nightStart), b = mins(nightEnd);
  const isNight = a < b ? t >= a && t < b : t >= a || t < b;
  if (mode === 'home' && isNight) return { mode: 'night', why: `It’s ${now.toTimeString().slice(0, 5)} — switch to NIGHT?` };
  if (mode === 'night' && !isNight) return { mode: 'home', why: 'Morning — switch back to HOME?' };
  if (mode === 'home' && !isNight && lastActivity && now - lastActivity > quietHoursForAway * 3600000) return { mode: 'away', why: `No activity for ${quietHoursForAway} hours — is everyone out? Switch to AWAY?` };
  return null;
}
