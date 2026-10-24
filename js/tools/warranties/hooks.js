// Warranties & documents: search + "running out" reminders for the start menu.
import * as store from '../../core/store.js';
import { searchList } from '../../core/search.js';
import { expiryReminders } from '../../core/reminders.js';
import { kindOf } from './logic.js';

export function search(q) {
  const items = new Map(store.all('items').map((i) => [i.id, i.name]));
  return searchList(store.all('docs'), q, (d) => ({
    fields: [[d.title, 3], [items.get(d.itemId), 2], [d.seller, 1], [d.reference, 1.5], [d.notes, 0.5], [kindOf(d.kind).label, 0.5]],
    title: d.title, sub: [kindOf(d.kind).label, items.get(d.itemId), d.expiry ? `until ${d.expiry}` : ''].filter(Boolean).join(' · '), href: `#/warranties/doc/${d.id}`,
  }));
}

export const reminders = (now) => expiryReminders(store.all('docs').filter((d) => d.kind === 'warranty' || d.kind === 'insurance'), now, {
  soon: 30, after: 30,
  get: (d) => d.expiry && { date: d.expiry, title: d.title, href: `#/warranties/doc/${d.id}`, kind: d.kind, icon: kindOf(d.kind).icon, soonText: 'Runs out', expiredText: 'Ran out' },
});
