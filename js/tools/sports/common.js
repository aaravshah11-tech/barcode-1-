// Shared sports helpers: clock, sides, player labels, events.
import * as store from '../../core/store.js';
import { teamName, playerLabel, player, numberIn, team } from '../../core/people.js';

export const SPORT_INFO = {
  rugby: { name: 'Rugby', emoji: '🏉', periods: 2, periodMins: 40, periodName: (n, of) => (n <= of ? (n === 1 ? '1st half' : n === 2 ? '2nd half' : `Half ${n}`) : `Extra time ${n - of}`) },
  hockey: { name: 'Hockey', emoji: '🏑', periods: 4, periodMins: 15, periodName: (n, of) => (n <= of ? `Q${n}` : `Shoot-out/ET ${n - of}`) },
  cricket: { name: 'Cricket', emoji: '🏏' },
};

export const matches = (sport) => store.all('matches').filter((m) => !sport || m.sport === sport).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
export const match = (id) => store.get('matches', id);
export const eventsOf = (matchId) => store.all('events').filter((e) => e.matchId === matchId).sort((a, b) => a.t - b.t || (a.createdAt || 0) - (b.createdAt || 0));

export function sideName(m, side) {
  if (side === 'us') return teamName(m.teamId, 'Us');
  return (m.oppTeamId && teamName(m.oppTeamId, '')) || m.oppName || 'Opposition';
}
export const sideColor = (m, side) => (side === 'us' ? team(m.teamId)?.colour : team(m.oppTeamId)?.colour) || (side === 'us' ? 'var(--c1)' : 'var(--c2)');

/** Player references: a player id, or "opp#7" for an opposition shirt number. */
export function refLabel(m, ref, { short = false } = {}) {
  if (!ref) return '';
  if (String(ref).startsWith('opp#')) return `#${ref.slice(4)}`;
  if (String(ref).startsWith('name:')) return ref.slice(5);
  const p = player(ref);
  if (!p) return '?';
  const teamId = (p.teamIds || []).includes(m.teamId) ? m.teamId : m.oppTeamId;
  const n = numberIn(p, teamId);
  const name = short ? p.name.split(' ').slice(-1)[0] : p.name;
  return n != null && n !== '' ? `#${n} ${name}` : name;
}

// ---------- match clock (stored on the match so every device shows the same time) ----------
export function clockMs(m, now = Date.now()) {
  const c = m.clock || {};
  return Math.max(0, (c.elapsedMs || 0) + (c.running && c.startedAt ? now - c.startedAt : 0));
}
export const periodMs = (m) => (m.format?.periodMins || SPORT_INFO[m.sport]?.periodMins || 40) * 60000;
/** Time since kick-off, counting full earlier periods (used for sin-bins and minute labels). */
export const matchTime = (m, period, clock) => (Math.max(1, period) - 1) * periodMs(m) + clock;
export const minuteOf = (m, e) => Math.floor(matchTime(m, e.period, e.clockMs) / 60000) + 1;

export async function startClock(m) {
  if (m.clock?.running) return m;
  return store.put('matches', { ...m, status: 'live', clock: { ...(m.clock || { period: 1, elapsedMs: 0 }), period: m.clock?.period || 1, running: true, startedAt: Date.now() } });
}
export async function pauseClock(m) {
  if (!m.clock?.running) return m;
  return store.put('matches', { ...m, clock: { ...m.clock, running: false, startedAt: null, elapsedMs: clockMs(m) } });
}
export async function nextPeriod(m) {
  const period = (m.clock?.period || 1) + 1;
  return store.put('matches', { ...m, clock: { period, running: false, startedAt: null, elapsedMs: 0 } });
}
export async function setClock(m, ms) {
  return store.put('matches', { ...m, clock: { ...(m.clock || { period: 1 }), elapsedMs: ms, startedAt: m.clock?.running ? Date.now() : null } });
}

/** Log an event with the current clock. */
export function logEvent(m, ev) {
  return store.put('events', { matchId: m.id, sport: m.sport, t: Date.now(), period: m.clock?.period || 1, clockMs: clockMs(m), side: 'us', ...ev });
}

/** Win / draw / loss from our point of view. */
export const resultOf = (us, them) => (us > them ? 'W' : us < them ? 'L' : 'D');
export const playerRefs = (events, side) => [...new Set(events.filter((e) => e.side === side && e.player).map((e) => e.player))];
