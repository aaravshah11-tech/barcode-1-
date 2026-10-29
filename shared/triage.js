// TRIAGE + INCIDENTS: the rules, kept separate from storage so they can be tested on their own.
//  - Which Mission Log events become alerts, and how severe they are.
//  - Incident references (INC-2026-0042) and the order an incident moves through.

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const SEV_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export const validSeverity = (s) => (SEVERITIES.includes(s) ? s : 'MEDIUM');
/** One step up (Escalate). */
export const escalated = (s) => SEVERITIES[Math.min(SEVERITIES.length - 1, SEVERITIES.indexOf(validSeverity(s)) + 1)];

/** Alert statuses. "new" = nobody has handled it yet (it shows its age). */
export const ALERT_STATUS = { new: 'Unhandled', acknowledged: 'Acknowledged', escalated: 'Escalated', dismissed: 'Dismissed', incident: 'In incident' };
export const OPEN_ALERT = new Set(['new', 'acknowledged', 'escalated']);

export const DISMISS_REASONS = ['False alarm', 'Expected activity (household member)', 'Test', 'Duplicate', 'Other'];

const SENSOR = new Set(['motion', 'door', 'sound', 'light', 'knock']);

/**
 * Should this Mission Log event become an alert, and how severe is it? Returns null for "just log it".
 * Ordinary activity while someone is home is logged only; the alert state (HOME/AWAY/NIGHT/LOCKDOWN)
 * already decided whether a sensor event counts as an intrusion (level 'alert').
 */
export function severityFor(ev) {
  if (!ev || ev.kind === 'threat') return null; // the threat level is derived from the events themselves
  const msg = String(ev.message || '');
  if (ev.kind === 'system') {
    if (/^PANIC raised/.test(msg)) return 'CRITICAL';
    if (/^Failed login attempt/.test(msg)) return 'MEDIUM';
    if (/^Internet connection lost/.test(msg)) return 'LOW';
    return null; // mode changes, alarm protocol, stand-downs, phones linking: recorded, not alerts
  }
  if (SENSOR.has(ev.kind)) {
    if (ev.level === 'alert') return ev.data?.armed === 'lockdown' ? 'CRITICAL' : 'HIGH';
    if (ev.level === 'warn') return 'LOW';
    return null;
  }
  if (ev.kind === 'agent') {
    if (/disconnected by HQ/.test(msg)) return null; // done on purpose by the operator
    return ev.level === 'warn' || ev.level === 'alert' ? 'LOW' : null; // offline, low battery
  }
  return ev.level === 'alert' ? 'HIGH' : null;
}

/** Short title for an alert made from an event ("Motion — Kitchen"). */
export function alertTitle(ev, roomName = '') {
  const msg = String(ev.message || '');
  const what = {
    motion: 'Motion detected', door: /clos/i.test(msg) ? 'Door closed' : 'Door opened', sound: 'Loud sound', light: 'Light change', knock: 'Door panel pressed',
  }[ev.kind];
  if (what) return roomName ? `${what} — ${roomName}` : what;
  if (/^PANIC/.test(msg)) return 'Panic raised';
  if (/^Failed login/.test(msg)) return 'Failed sign-in attempt';
  if (/offline/.test(msg)) return 'Agent offline';
  if (/battery/i.test(msg)) return 'Agent battery low';
  if (/^Internet connection lost/.test(msg)) return 'Internet connection lost';
  return msg.replace(/^AGENT-\d+ [A-Z]+: /, '').slice(0, 70);
}

/** Why it is an alert, in plain English. */
export function alertExplanation(ev) {
  const armed = ev.data?.armed;
  if (armed === 'lockdown') return 'Activity while the house is in LOCKDOWN. Every Agent is armed.';
  if (armed === 'away') return 'Activity while the house is set to AWAY (nobody should be home).';
  if (armed === 'night') return 'Activity from an Agent armed for NIGHT while the household is asleep.';
  if (/^PANIC/.test(ev.message || '')) return 'Someone pressed Panic. Treat as an emergency until confirmed.';
  if (/^Failed login/.test(ev.message || '')) return 'A wrong username or PIN was entered. Repeated failures lock sign-in.';
  return '';
}

// ---------- incidents ----------
export const INCIDENT_STATUS = ['open', 'investigating', 'resolved', 'closed'];
export const INCIDENT_LABEL = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed' };
/** Allowed moves: forward one step, close straight from open, or reopen a resolved one. */
export function canMove(from, to) {
  if (from === to) return false;
  const i = INCIDENT_STATUS.indexOf(from), j = INCIDENT_STATUS.indexOf(to);
  if (i < 0 || j < 0 || from === 'closed') return false;
  return j === i + 1 || (from === 'open' && to === 'closed') || (from === 'resolved' && to === 'investigating');
}
/** INC-2026-0042 */
export const incidentRef = (year, n) => `INC-${year}-${String(n).padStart(4, '0')}`;

/** "4 min", "2 h 05 min", "3 d" — how long an alert has been waiting. */
export function ageText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(m / 1440)} d`;
}
