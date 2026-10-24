// Golf: search golfers and named practice sessions.
import * as store from '../../core/store.js';
import { searchList } from '../../core/search.js';

export function search(q) {
  const golfers = searchList(store.all('golfers'), q, (g) => ({ fields: [[g.name, 3]], title: g.name, sub: 'Golfer', href: `#/golf/golfers/${g.id}` }), 10);
  const sessions = searchList(store.all('golfSessions').filter((s) => s.name || s.notes), q, (s) => ({ fields: [[s.name, 3], [s.notes, 1]], title: s.name || 'Practice session', sub: 'Practice session', href: `#/golf/session/${s.id}` }), 10);
  const clubs = searchList(store.all('swings'), q, (s) => ({ fields: [[s.club, 2]], title: `${s.club} swing`, sub: new Date(s.t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), href: `#/golf/swing/${s.id}` }), 5);
  return [...golfers, ...sessions, ...clubs].sort((a, b) => b.score - a.score);
}
