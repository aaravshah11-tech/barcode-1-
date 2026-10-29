// ROLES: who may do what. HQ checks this on EVERY request (the HQ computer and linked phones alike),
// so hiding a button is never the only protection.
//   DIRECTOR — everything, including users, the audit log, backups and recruiting.
//   OPERATOR — runs the house: triage, incidents, alert states, messages, Agents' missions, reports.
//   OBSERVER — can look at everything allowed but change nothing.
export const ROLES = ['DIRECTOR', 'OPERATOR', 'OBSERVER'];
export const ROLE_INFO = {
  DIRECTOR: 'Full control, including users, the audit log, backups and recruiting.',
  OPERATOR: 'Handles alerts and incidents, changes the alert state, sends messages and runs Agents.',
  OBSERVER: 'Read-only: can watch the screens but cannot change anything.',
};

/** Only the Director: people, keys, data and the audit trail. */
const DIRECTOR_ONLY = [
  /^\/users/, /^\/audit/, /^\/backup/, /^\/restore/, /^\/data\//, /^\/pair$/, /^\/viewers/, /^\/auth\/sessions/,
];
/** What an Observer may still do (besides reading). */
const OBSERVER_WRITE = [/^\/auth\/(lock|change)$/, /^\/auth\/totp\//];
const READ_ONLY_FOR_DIRECTOR = [/^\/export$/]; // GET, but sensitive: Director only

/** Returns null if allowed, or the reason it isn't. */
export function denied(role, method, path, body = {}) {
  const m = method.toUpperCase();
  if (!ROLES.includes(role)) return 'Sign in first.';
  if (role === 'DIRECTOR') return null;
  if (DIRECTOR_ONLY.some((r) => r.test(path)) || READ_ONLY_FOR_DIRECTOR.some((r) => r.test(path))) return 'Only the Director can do that.';
  if (m === 'DELETE' && /^\/agents\//.test(path)) return 'Only the Director can remove an Agent.';
  if (m === 'PATCH' && path === '/settings') {
    const keys = Object.keys(body || {}).filter((k) => k !== 'by');
    if (role === 'OPERATOR' && keys.every((k) => ['mode', 'reason'].includes(k))) return null;
    if (role === 'OPERATOR') return 'Operators can change the alert state; other settings are for the Director.';
  }
  if (role === 'OBSERVER' && m !== 'GET' && !OBSERVER_WRITE.some((r) => r.test(path))) return 'Observers can look but not change anything.';
  return null;
}
