// Sports: search (matches, players, teams) + upcoming-match reminders for the start menu.
import * as store from '../../core/store.js';
import { searchList } from '../../core/search.js';
import { matchReminders } from '../../core/reminders.js';

const SPORT = { rugby: '🏉', cricket: '🏏', hockey: '🏑' };

export function search(q) {
  const teams = new Map(store.all('teams').map((t) => [t.id, t]));
  const matches = searchList(store.all('matches'), q, (m) => ({
    fields: [[m.title, 3], [m.oppName, 2], [teams.get(m.teamId)?.name, 1.5], [m.venue, 1], [m.date, 1], [m.sport, 0.5]],
    title: `${SPORT[m.sport] || ''} ${m.title || 'Match'}`.trim(), sub: [m.date, m.venue, m.status === 'live' ? 'LIVE' : m.status === 'upcoming' ? 'upcoming' : ''].filter(Boolean).join(' · '),
    href: `#/sports/match/${m.id}`,
  }));
  const players = searchList(store.all('players'), q, (p) => ({
    fields: [[p.name, 3], [(p.teamIds || []).map((id) => teams.get(id)?.name), 0.5]],
    title: p.name, sub: `Player · ${(p.teamIds || []).map((id) => teams.get(id)?.name).filter(Boolean).join(', ')}`, href: '#/settings/teams',
  }), 10);
  const tms = searchList([...teams.values()], q, (t) => ({ fields: [[t.name, 3], [t.sport, 0.5]], title: t.name, sub: `Team · ${t.sport || ''}`, href: '#/settings/teams' }), 5);
  return [...matches, ...players, ...tms].sort((a, b) => b.score - a.score);
}

export const reminders = (now) => matchReminders(store.all('matches'), now);
