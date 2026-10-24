// Library: search + reminders for the start menu.
import * as store from '../../core/store.js';
import { locationLabel } from '../../core/locations.js';
import { searchList, sameCode } from '../../core/search.js';
import { lentReminders } from '../../core/reminders.js';

export function search(q) {
  const code = q.replace(/[\s-]/g, '');
  return searchList(store.all('books'), q, (b) => ({
    fields: [[b.title, 3], [b.subtitle, 1], [b.authors, 2], [b.subjects, 0.6], [b.owner, 0.6], [b.lentTo, 1], [b.publisher, 0.5], [locationLabel(b.location), 0.6],
      ...(/^\d{9,13}X?$/i.test(code) && (sameCode(b.isbn13, code) || sameCode(b.isbn10, code)) ? [[code, 5]] : [])],
    title: b.title, sub: [(b.authors || []).join(', '), b.location?.roomId ? locationLabel(b.location) : '', b.lentTo ? `lent to ${b.lentTo}` : ''].filter(Boolean).join(' · '),
    href: `#/library/book/${b.id}`,
  }));
}

export const reminders = (now) => lentReminders(store.all('books'), now, { what: 'book', label: (b) => b.title, href: (b) => `#/library/book/${b.id}`, dateOf: (b) => b.lentDate });
