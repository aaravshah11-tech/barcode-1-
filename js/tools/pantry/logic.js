// Pantry rules (pure, unit tested): expiry status, grouping, remembered shelf life.
import { dayMs, daysFrom, whenText, DAY } from '../../core/reminders.js';

export const STORAGE = [
  { id: 'fridge', label: 'Fridge', icon: '🧊' },
  { id: 'freezer', label: 'Freezer', icon: '❄️' },
  { id: 'cupboard', label: 'Cupboard', icon: '🥫' },
];
export const storageOf = (id) => STORAGE.find((s) => s.id === id) || STORAGE[2];
export const SOON_DAYS = 3;

export const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (from, n) => isoDay(dayMs(from) + n * DAY + 12 * 3600000); // midday avoids clock-change edge cases

/** "today", "tomorrow", "Tue 27 Oct (3 days)", "31 Oct", "12 Mar 2027". */
export function niceDay(iso, now) {
  const d = daysFrom(now, iso);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  const date = new Date(dayMs(iso));
  if (d > 1 && d < 7) return `${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} (${d} days)`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: Math.abs(d) > 300 ? 'numeric' : undefined });
}

/** { key: 'expired' | 'soon' | 'week' | 'later' | 'none', days, text } */
export function expiryStatus(expiry, now) {
  if (!expiry || dayMs(expiry) == null) return { key: 'none', days: null, text: 'No date' };
  const days = daysFrom(now, expiry);
  const text = days < 0 ? `Past its date (${whenText(dayMs(expiry), now)})` : `Use by ${niceDay(expiry, now)}`;
  return { key: days < 0 ? 'expired' : days <= SOON_DAYS ? 'soon' : days <= 7 ? 'week' : 'later', days, text };
}

export const GROUPS = [
  ['expired', 'Past its date'], ['soon', `Use in the next ${SOON_DAYS} days`], ['week', 'This week'], ['later', 'Later'], ['none', 'No date'],
];

/** Group and sort: soonest first inside each group, no-date items by name. */
export function groupPantry(items, now) {
  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  for (const i of items) by[expiryStatus(i.expiry, now).key].push(i);
  for (const [k, list] of Object.entries(by)) list.sort((a, b) => (k === 'none' ? 0 : dayMs(a.expiry) - dayMs(b.expiry)) || (a.name || '').localeCompare(b.name || ''));
  return GROUPS.map(([k, label]) => ({ key: k, label, items: by[k] })).filter((g) => g.items.length);
}

/** How long this product usually lasts (days from adding to its date), learnt from what you saved. */
export function shelfDays(item) {
  if (!item.expiry || !item.addedAt) return null;
  const d = daysFrom(item.addedAt, item.expiry);
  return d > 0 && d < 3650 ? d : null;
}

/** Suggested date for a new one of this product. */
export const suggestExpiry = (product, now) => (product?.shelfDays ? addDays(now, product.shelfDays) : '');

/** Quick picks shown under the date field. */
export const QUICK = [['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['6 months', 182], ['1 year', 365]];
