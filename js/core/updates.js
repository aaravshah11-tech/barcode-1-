// "Is there a newer HomeBase?" — compares this copy's version with what the website has,
// and lists the changes in between (changelog.json). Used by Settings › Updates and the start menu.
import { VERSION, CHANGELOG_ID } from '../version.js';

export { VERSION };
export const shortVersion = (v = VERSION) => v.replace(/^homebase-/, '').slice(0, 7);

const fresh = (path) => fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

/** { available, current, latest, news: [changelog entries newer than this copy], log: [all entries] } */
export async function checkForUpdate() {
  const [v, log] = await Promise.all([fresh('version.json'), fresh('changelog.json').catch(() => [])]);
  return { available: !!v.version && v.version !== VERSION, current: VERSION, latest: v.version, news: log.filter((e) => e.id > CHANGELOG_ID), log };
}

/** Install the new version and restart the app. */
export async function applyUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) { location.reload(); return; }
  setTimeout(() => location.reload(), 8000); // in case the browser never says it switched
  if (!reg.waiting) {
    await reg.update();
    const sw = reg.installing || reg.waiting;
    if (sw && sw.state !== 'installed') {
      await new Promise((res) => sw.addEventListener('statechange', () => { if (['installed', 'activated', 'redundant'].includes(sw.state)) res(); }));
    }
  }
  if (reg.waiting) reg.waiting.postMessage('skipWaiting'); // the app reloads itself when the new version takes over
  else location.reload();
}

/** Last resort: forget the cached app completely and load it fresh (your data is kept). */
export async function forceFreshCopy() {
  try { for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister(); } catch { /* ignore */ }
  try { for (const k of await caches.keys()) if (k !== 'shelf-covers') await caches.delete(k); } catch { /* ignore */ }
  location.reload();
}
