// Pantry: search + use-by reminders for the start menu.
import * as store from '../../core/store.js';
import { searchList, sameCode } from '../../core/search.js';
import { expiryReminders } from '../../core/reminders.js';
import { storageOf, expiryStatus, SOON_DAYS } from './logic.js';

export function search(q) {
  const now = Date.now();
  const food = searchList(store.all('pantry'), q, (f) => ({
    fields: [[f.name, 3], [f.brand, 1.5], [storageOf(f.storage).label, 0.5], ...(sameCode(f.barcode, q) ? [[q, 5]] : [])],
    title: `${f.name}${(f.quantity || 1) > 1 ? ` ×${f.quantity}` : ''}`, sub: `${storageOf(f.storage).label} · ${expiryStatus(f.expiry, now).text}`, href: `#/pantry/item/${f.id}`,
  }));
  const list = searchList(store.all('shopping').filter((s) => !s.done), q, (s) => ({ fields: [[s.name, 2]], title: s.name, sub: 'On the shopping list', href: '#/pantry/shopping' }), 10);
  return [...food, ...list].sort((a, b) => b.score - a.score);
}

export function reminders(now) {
  const list = expiryReminders(store.all('pantry'), now, {
    soon: SOON_DAYS, after: 7,
    get: (f) => f.expiry && { date: f.expiry, title: `${f.name}${(f.quantity || 1) > 1 ? ` ×${f.quantity}` : ''}`, href: `#/pantry/item/${f.id}`, kind: 'food', icon: '🥫', soonText: 'Use by', expiredText: 'Past its date' },
  });
  // Lots of food at once: one reminder instead of a long list.
  if (list.length <= 4) return list;
  const expired = list.filter((r) => r.level === 'danger').length;
  return [{ id: `food:many:${list.map((r) => r.id).join('|')}`, kind: 'food', icon: '🥫', level: expired ? 'danger' : 'warn', title: `${list.length} foods to use up`, sub: `${expired ? `${expired} past their date · ` : ''}${list.slice(0, 3).map((r) => r.title).join(', ')}…`, href: '#/pantry', due: Math.min(...list.map((r) => r.due)) }];
}
