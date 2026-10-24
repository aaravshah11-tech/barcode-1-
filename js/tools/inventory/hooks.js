// Inventory: search + reminders for the start menu.
import * as store from '../../core/store.js';
import { locationLabel, allRooms } from '../../core/locations.js';
import { searchList, sameCode } from '../../core/search.js';
import { lentReminders } from '../../core/reminders.js';

export function search(q) {
  const code = q.replace(/[\s-]/g, '');
  const items = searchList(store.all('items'), q, (i) => ({
    fields: [[i.name, 3], [i.brand, 1.5], [i.category, 1], [i.notes, 0.5], [i.owner, 0.6], [i.lentTo, 1], [locationLabel(i.location), 0.8], ...(/^\d{6,14}$/.test(code) && sameCode(i.barcode, code) ? [[code, 5]] : [])],
    title: i.name, sub: [i.brand, i.location?.roomId ? locationLabel(i.location) : '', i.quantity > 1 ? `×${i.quantity}` : '', i.lentTo ? `lent to ${i.lentTo}` : ''].filter(Boolean).join(' · '),
    href: `#/inventory/item/${i.id}`,
  }));
  // Places: rooms, cupboards, boxes.
  const places = [];
  for (const r of allRooms()) {
    places.push({ fields: [[r.name, 2]], title: r.name, sub: 'Room', href: `#/inventory/place/${r.id}` });
    for (const a of r.areas || []) {
      places.push({ fields: [[a.name, 2], [r.name, 0.5]], title: a.name, sub: `Place in ${r.name}`, href: `#/inventory/place/${r.id}/${a.id}` });
      for (const s of a.spots || []) places.push({ fields: [[s.name, 2], [a.name, 0.5], [r.name, 0.3]], title: s.name, sub: `${r.name} › ${a.name}`, href: `#/inventory/place/${r.id}/${a.id}/${s.id}` });
    }
  }
  return [...items, ...searchList(places, q, (p) => p, 10)].sort((a, b) => b.score - a.score);
}

export const reminders = (now) => lentReminders(store.all('items'), now, { what: 'item', label: (i) => i.name, href: (i) => `#/inventory/item/${i.id}`, dateOf: (i) => i.lentDate });
