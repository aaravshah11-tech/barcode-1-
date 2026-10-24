// Reminder rules shared by the tools' hooks.js `reminders(now)`. Pure functions, unit tested.
// Each reminder: { id, kind, icon, title, sub, href, due (ms), level: 'info' | 'warn' | 'danger' }

export const DAY = 86400000;
export const LENT_DAYS = 30;

/** 'YYYY-MM-DD' (local) or a timestamp → ms at local midnight. */
export function dayMs(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'number') { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}
export const daysFrom = (from, to) => Math.round((dayMs(to) - dayMs(from)) / DAY);

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function whenText(due, now) {
  const d = daysFrom(now, due);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 1 && d < 7) return `in ${d} days`;
  if (d < -1 && d > -60) return `${-d} days ago`;
  return new Date(due).toLocaleDateString([], { day: 'numeric', month: 'short', year: Math.abs(d) > 300 ? 'numeric' : undefined });
}

/**
 * Things lent out for more than 30 days. Older records saved before lending dates existed
 * fall back to when the record was last changed ("at least").
 */
export function lentReminders(list, now, { what, label, href, dateOf, days = LENT_DAYS }) {
  const out = [];
  for (const r of list) {
    if (!r.lentTo) continue;
    const exact = dayMs(dateOf(r));
    const since = exact ?? dayMs(r.updatedAt || r.createdAt);
    if (since == null) continue;
    const n = daysFrom(since, now);
    if (n < days) continue;
    out.push({
      id: `lent:${what}:${r.id}`, kind: 'lent', icon: '🤝', level: n >= days * 3 ? 'danger' : 'warn',
      title: `${label(r)} — lent to ${r.lentTo}`, sub: `${exact == null ? 'at least ' : ''}${n} days ago`, href: href(r), due: since + days * DAY,
    });
  }
  return out;
}

/** Matches in the next `days` days that haven't started. */
export function matchReminders(matches, now, { days = 7 } = {}) {
  const ICON = { rugby: '🏉', cricket: '🏏', hockey: '🏑' };
  return matches.filter((m) => m.status === 'upcoming' && m.date).map((m) => ({ m, d: daysFrom(now, m.date) }))
    .filter(({ d }) => d >= 0 && d <= days)
    .map(({ m, d }) => ({
      id: `match:${m.id}:${m.date}`, kind: 'match', icon: ICON[m.sport] || '🏆', level: d <= 1 ? 'warn' : 'info',
      title: m.title || 'Match', sub: [whenText(dayMs(m.date), now), m.venue].filter(Boolean).join(' · '), href: `#/sports/match/${m.id}`, due: dayMs(m.date),
    }));
}

/**
 * Things with an expiry date: warn `soon` days before, keep showing for `after` days once expired.
 * get(r) → { date, title, href, kind, icon, expiredText?, soonText? }
 */
export function expiryReminders(list, now, { soon = 30, after = 30, get }) {
  const out = [];
  for (const r of list) {
    const g = get(r);
    if (!g) continue;
    const due = dayMs(g.date);
    if (due == null) continue;
    const d = daysFrom(now, due);
    if (d > soon || d < -after) continue;
    out.push({
      id: `${g.kind}:${r.id}:${g.date}`, kind: g.kind, icon: g.icon, level: d < 0 ? 'danger' : d <= Math.min(7, soon) ? 'warn' : 'info',
      title: g.title, sub: d < 0 ? `${g.expiredText || 'Expired'} ${whenText(due, now)}` : `${g.soonText || 'Expires'} ${whenText(due, now)}`, href: g.href, due,
    });
  }
  return out;
}

/** Most urgent first: overdue/expired, then soonest. */
export const sortReminders = (list) => list.slice().sort((a, b) => (a.due ?? 0) - (b.due ?? 0));

/** Hide snoozed ones. snoozes: [{ id, until }] */
export const activeReminders = (list, snoozes, now) => {
  const s = new Map(snoozes.map((x) => [x.id, x.until]));
  return list.filter((r) => !(s.get(r.id) > now));
};
