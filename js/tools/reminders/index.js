// 🔔 Reminders: things lent out too long, warranties and food running out, upcoming matches.
import * as store from '../../core/store.js';
import { esc, icon, toast } from '../../core/ui.js';
import { collectReminders, snooze, unsnooze } from './collect.js';

const SECTIONS = [
  ['now', 'Needs attention', (r, now) => r.level === 'danger' || r.due <= now],
  ['week', 'This week', (r, now) => r.due - now <= 7 * 86400000],
  ['later', 'Coming up', () => true],
];

export function renderReminders(root) {
  let drawId = 0;
  const draw = async () => {
    const id = ++drawId;
    const now = Date.now();
    const list = await collectReminders(now);
    if (id !== drawId) return;
    const hidden = store.all('reminderSnoozes').filter((s) => s.until > now).length;
    const used = new Set();
    const sections = SECTIONS.map(([key, title, test]) => {
      const items = list.filter((r) => !used.has(r.id) && test(r, now));
      items.forEach((r) => used.add(r.id));
      return [key, title, items];
    }).filter(([, , items]) => items.length);
    root.innerHTML = `<div class="page-head"><h1>Reminders</h1></div>
      <p class="muted">Lent-out things over 30 days, warranties and food running out, and matches in the next week. Everything here comes from your other tools.</p>
      ${sections.length ? sections.map(([key, title, items]) => `<section class="section" data-sec="${key}"><div class="section-title">${esc(title)} <span class="muted">${items.length}</span></div>
        <div class="list">${items.map((r) => `<div class="list-item rem rem-${r.level}" data-rid="${esc(r.id)}">
          <span class="rem-icon" aria-hidden="true">${r.icon}</span>
          <a class="grow rem-link" href="${esc(r.href)}"><div class="row-title">${esc(r.title)}</div><div class="small muted">${esc(r.sub)} · ${esc(r.tool.name)}</div></a>
          <button class="btn btn-sm btn-ghost" data-snooze="${esc(r.id)}" aria-label="Hide “${esc(r.title)}” for a week">Hide 7 days</button></div>`).join('')}</div></section>`).join('')
        : '<div class="empty"><div class="art">✅</div><h2>All clear</h2><p class="muted">Nothing lent out too long, nothing expiring and no matches this week.</p></div>'}
      ${hidden ? `<p class="small muted">${hidden} hidden for now · <button class="link-btn" data-unhide>Show them again</button></p>` : ''}`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.snooze) {
      const rid = b.dataset.snooze;
      b.closest('.list-item')?.classList.add('rem-gone');
      await snooze(rid);
      toast('Hidden for 7 days', { actionLabel: 'Undo', onAction: () => unsnooze(rid) });
    }
    if ('unhide' in b.dataset) for (const s of store.all('reminderSnoozes')) await unsnooze(s.id);
  });
  draw();
  // Anything in another tool can change a reminder; redraw shortly after changes settle.
  let t = null;
  const off = store.onChange(({ changes }) => {
    if (!changes.some((c) => c.c !== '_local')) return;
    clearTimeout(t); t = setTimeout(draw, 150);
  });
  return () => { off(); clearTimeout(t); };
}

export default {
  routes: { '': renderReminders },
  nav: [],
};
