// Threat level, worked out from recent Mission Log events and who's home. Pure function, unit tested.
//   GREEN — all quiet
//   AMBER — activity in the last few minutes (someone's home, or we don't know)
//   RED   — motion / door / sound / light / knock while nobody's home

export const ACTIVITY_KINDS = new Set(['motion', 'door', 'sound', 'light', 'knock']);

/**
 * mode: 'auto' (use Wi-Fi recon), 'home' or 'away' (set by hand on the dashboard).
 * Returns { level, reason, away, at }.
 */
export function computeThreat({ events = [], people = [], mode = 'auto', now = Date.now(), activityMin = 5, alertMin = 15 } = {}) {
  const tracked = people.filter((p) => p.enabled);
  const away = mode === 'away' ? true : mode === 'home' ? false : tracked.length > 0 && tracked.every((p) => !p.home);
  const recent = events.filter((e) => ACTIVITY_KINDS.has(e.kind) && now - e.ts <= Math.max(activityMin, alertMin) * 60000).sort((a, b) => b.ts - a.ts);
  const red = away && recent.find((e) => now - e.ts <= alertMin * 60000);
  if (red) return { level: 'RED', reason: `${red.message} while nobody’s home`, away, at: red.ts };
  const amber = recent.find((e) => now - e.ts <= activityMin * 60000);
  if (amber) return { level: 'AMBER', reason: amber.message, away, at: amber.ts };
  return { level: 'GREEN', reason: away ? 'All quiet · nobody home' : 'All quiet', away, at: null };
}
