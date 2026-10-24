// Shared people: family members (owners/borrowers), sports teams and players.
import * as store from './store.js';
import { esc, icon, promptDialog } from './ui.js';

// ---------- family ----------
export const family = () => store.setting('family', []);
export async function addFamily(name) {
  name = name.trim();
  if (name && !family().includes(name)) await store.setSetting('family', [...family(), name]);
}
export const removeFamily = (name) => store.setSetting('family', family().filter((x) => x !== name));

/** Family-member chips. */
export function ownerPicker(container, value, onChange) {
  let current = value || '';
  const render = () => {
    container.innerHTML = `<div class="chips">${family().map((o) => `<button type="button" class="chip" data-owner="${esc(o)}" aria-pressed="${o === current}">${esc(o)}</button>`).join('')}
      <button type="button" class="chip chip-add" data-add-owner>${icon('plus')} Person</button></div>`;
  };
  container.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.owner != null) current = current === b.dataset.owner ? '' : b.dataset.owner;
    else if ('addOwner' in b.dataset) {
      const name = await promptDialog({ title: 'Add a family member', placeholder: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await addFamily(name);
      current = name.trim();
    } else return;
    render();
    onChange?.(current);
  });
  render();
  return { get value() { return current; } };
}

// ---------- sports teams & players ----------
export const SPORTS = [
  { id: 'rugby', name: 'Rugby', emoji: '🏉' },
  { id: 'cricket', name: 'Cricket', emoji: '🏏' },
  { id: 'hockey', name: 'Hockey', emoji: '🏑' },
];

/** Teams: { name, club, sport, mine, colour }. */
export const teams = (sport) => store.all('teams').filter((t) => !sport || t.sport === sport).sort((a, b) => (b.mine - a.mine) || a.name.localeCompare(b.name));
export const team = (id) => store.get('teams', id);
export const teamName = (id, fallback = 'Opposition') => team(id)?.name || fallback;

/** Players: { name, teamIds: [], numbers: { teamId: n } }. A player can be in several teams. */
export const players = (teamId) => store.all('players').filter((p) => !teamId || (p.teamIds || []).includes(teamId))
  .sort((a, b) => (numberIn(a, teamId) ?? 999) - (numberIn(b, teamId) ?? 999) || a.name.localeCompare(b.name));
export const player = (id) => store.get('players', id);
export const numberIn = (p, teamId) => (p?.numbers?.[teamId] ?? p?.number ?? null);
export function playerLabel(id, teamId) {
  const p = player(id);
  if (!p) return '';
  const n = numberIn(p, teamId);
  return n != null && n !== '' ? `#${n} ${p.name}` : p.name;
}
export const shortName = (name = '') => { const parts = name.trim().split(/\s+/); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name; };

// ---------- who's who ----------
// Each device says whose it is (synced 'profiles' record, id = device id), so
// "added by" and the household list can show names. Works with any kind of sync.
const deviceLabel = () => { const ua = navigator.userAgent; return /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : 'Computer'; };
export const myName = () => store.getLocal('me.name', '') || store.get('profiles', store.getDeviceId())?.name || '';
export async function setMyName(name) {
  const n = String(name || '').trim().slice(0, 60);
  await store.setLocal('me.name', n);
  await store.put('profiles', { id: store.getDeviceId(), name: n, device: deviceLabel() });
  if (n && !family().includes(n)) await addFamily(n);
  return n;
}
export const nameOfDevice = (deviceId) => (deviceId ? store.get('profiles', deviceId)?.name || '' : '');
export const profiles = () => store.all('profiles').filter((p) => p.name);
