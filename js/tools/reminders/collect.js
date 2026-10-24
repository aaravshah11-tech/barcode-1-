// Gather reminders from every tool's hooks.js, minus the ones someone hid for now.
import * as store from '../../core/store.js';
import { loadHooks } from '../../tools.js';
import { sortReminders, activeReminders } from '../../core/reminders.js';

export async function collectReminders(now = Date.now()) {
  const hooks = await loadHooks();
  const all = [];
  for (const h of hooks) {
    if (!h.reminders) continue;
    try { for (const r of h.reminders(now)) all.push({ ...r, tool: h.tool }); } catch (e) { console.error(`${h.tool.id} reminders`, e); }
  }
  return sortReminders(activeReminders(all, store.all('reminderSnoozes'), now));
}

/** Hide a reminder for `days` (synced, so it's hidden on every device). */
export const snooze = (id, days = 7) => store.put('reminderSnoozes', { id, until: Date.now() + days * 86400000 });
export const unsnooze = (id) => store.remove('reminderSnoozes', id);
