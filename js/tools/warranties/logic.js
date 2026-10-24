// Warranties & documents rules (pure, unit tested).
import { dayMs, daysFrom, DAY } from '../../core/reminders.js';

export const KINDS = [
  { id: 'warranty', label: 'Warranty', icon: '🛡️' },
  { id: 'receipt', label: 'Receipt', icon: '🧾' },
  { id: 'manual', label: 'Manual', icon: '📘' },
  { id: 'insurance', label: 'Insurance', icon: '📄' },
  { id: 'other', label: 'Other', icon: '🗂️' },
];
export const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[4];
export const SOON_DAYS = 60;

/** Purchase date + N months → 'YYYY-MM-DD' (31 Jan + 1 month = 28/29 Feb, like shops count it). */
export function addMonths(iso, months) {
  const t = dayMs(iso);
  if (t == null || !months) return '';
  const d = new Date(t);
  const target = new Date(d.getFullYear(), d.getMonth() + Number(months), 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

/** { key: 'expired' | 'soon' | 'active' | 'none', days } */
export function docStatus(doc, now) {
  if (!doc.expiry || dayMs(doc.expiry) == null) return { key: 'none', days: null };
  const days = daysFrom(now, doc.expiry);
  return { key: days < 0 ? 'expired' : days <= SOON_DAYS ? 'soon' : 'active', days };
}

export const GROUPS = [['soon', 'Running out soon'], ['active', 'Covered'], ['none', 'No end date'], ['expired', 'Expired']];
export function groupDocs(docs, now) {
  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  for (const d of docs) by[docStatus(d, now).key].push(d);
  by.soon.sort((a, b) => dayMs(a.expiry) - dayMs(b.expiry));
  by.active.sort((a, b) => dayMs(a.expiry) - dayMs(b.expiry));
  by.expired.sort((a, b) => dayMs(b.expiry) - dayMs(a.expiry));
  by.none.sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '') || (a.title || '').localeCompare(b.title || ''));
  return GROUPS.map(([key, label]) => ({ key, label, docs: by[key] })).filter((g) => g.docs.length);
}

/** "2 years 3 months left", "5 days left", "ended 3 months ago". */
export function timeLeft(expiry, now) {
  const days = daysFrom(now, expiry);
  const a = Math.abs(days);
  const txt = a < 45 ? `${a} day${a === 1 ? '' : 's'}` : a < 365 ? `${Math.round(a / 30.4)} months` : (() => { const y = Math.floor(a / 365.25), m = Math.round((a - y * 365.25) / 30.4); return `${y} year${y === 1 ? '' : 's'}${m ? ` ${m} month${m === 1 ? '' : 's'}` : ''}`; })();
  return days < 0 ? `ended ${txt} ago` : days === 0 ? 'ends today' : `${txt} left`;
}
export { DAY };
