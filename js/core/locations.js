// Shared house locations: Room → Area (bookcase, cupboard…) → Spot (shelf, box…).
// Stored in the synced "rooms" collection. Library and Inventory both point at
// these with { roomId, areaId, spotId }.
import * as store from './store.js';
import { esc, icon, promptDialog, choose } from './ui.js';

/** Collections whose records have a `location` field (cleared when a place is deleted). */
export const LOCATION_USERS = ['books', 'items'];

export const AREA_KINDS = [
  { id: 'bookcase', label: 'Bookcase', spot: 'Shelf' },
  { id: 'cupboard', label: 'Cupboard', spot: 'Shelf' },
  { id: 'storage', label: 'Boxes / storage', spot: 'Box' },
  { id: 'area', label: 'Other area', spot: 'Spot' },
];
const kindOf = (k) => AREA_KINDS.find((x) => x.id === k) || AREA_KINDS[3];

export const allRooms = () => store.all('rooms').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
export const getRoom = (id) => store.get('rooms', id);
export const getArea = (roomId, areaId) => getRoom(roomId)?.areas?.find((a) => a.id === areaId) || null;
export const getSpot = (roomId, areaId, spotId) => getArea(roomId, areaId)?.spots?.find((s) => s.id === spotId) || null;

const saveRoom = (r) => store.put('rooms', { areas: [], ...r });
export const addRoom = (name) => saveRoom({ id: store.uid(), name: name.trim(), order: Date.now(), areas: [] });
export const renameRoom = (id, name) => saveRoom({ ...getRoom(id), name: name.trim() });

export async function addArea(roomId, name, kind = 'bookcase', spotCount = 0) {
  const r = getRoom(roomId);
  const k = kindOf(kind);
  const area = { id: store.uid(), name: name.trim(), kind, spots: Array.from({ length: spotCount }, (_, i) => ({ id: store.uid(), name: `${k.spot} ${i + 1}` })) };
  await saveRoom({ ...r, areas: [...(r.areas || []), area] });
  return area;
}
export async function updateArea(roomId, areaId, patch) {
  const r = getRoom(roomId);
  await saveRoom({ ...r, areas: r.areas.map((a) => (a.id === areaId ? { ...a, ...patch } : a)) });
}
export async function addSpot(roomId, areaId, name) {
  const a = getArea(roomId, areaId);
  const spot = { id: store.uid(), name: name.trim() };
  await updateArea(roomId, areaId, { spots: [...(a.spots || []), spot] });
  return spot;
}
export async function renameSpot(roomId, areaId, spotId, name) {
  const a = getArea(roomId, areaId);
  await updateArea(roomId, areaId, { spots: a.spots.map((s) => (s.id === spotId ? { ...s, name: name.trim() } : s)) });
}

async function clearRefs(match) {
  for (const c of LOCATION_USERS) {
    const hits = store.all(c).filter((x) => x.location && match(x.location));
    if (hits.length) await store.putMany(c, hits.map((x) => ({ ...x, location: null })));
  }
}
export async function deleteRoom(id) { await clearRefs((l) => l.roomId === id); await store.remove('rooms', id); }
export async function deleteArea(roomId, areaId) {
  await clearRefs((l) => l.roomId === roomId && l.areaId === areaId);
  const r = getRoom(roomId);
  await saveRoom({ ...r, areas: r.areas.filter((a) => a.id !== areaId) });
}
export async function deleteSpot(roomId, areaId, spotId) {
  await clearRefs((l) => l.spotId === spotId);
  const a = getArea(roomId, areaId);
  await updateArea(roomId, areaId, { spots: a.spots.filter((s) => s.id !== spotId) });
}

export const countAt = (match) => LOCATION_USERS.reduce((n, c) => n + store.all(c).filter((x) => x.location && match(x.location)).length, 0);

export function locationParts(loc) {
  const room = loc?.roomId ? getRoom(loc.roomId) : null;
  const area = room && loc.areaId ? room.areas.find((a) => a.id === loc.areaId) : null;
  const spot = area && loc.spotId ? area.spots.find((s) => s.id === loc.spotId) : null;
  return { room: room?.name || '', area: area?.name || '', spot: spot?.name || '' };
}
export function locationLabel(loc) {
  const p = locationParts(loc);
  const parts = [p.room, p.area, p.spot].filter(Boolean);
  return parts.length ? parts.join(' › ') : 'No location set';
}

/** Big step-by-step "Room → Area → Shelf" display. */
export function wherePathHtml(loc) {
  const p = locationParts(loc);
  const steps = [['Room', p.room], ['Area', p.area], ['Shelf / box', p.spot]].filter(([, v]) => v);
  if (!steps.length) return `<div class="banner banner-warn">${icon('info')}<div class="grow">No location saved yet.</div></div>`;
  return `<div class="where-path">${steps.map(([k, v], i) => `<div class="where-step"><span class="num">${i + 1}</span><div><small>${k}</small><b>${esc(v)}</b></div></div>`).join('')}</div>`;
}

// Remember the last place used, per tool, on this device.
export const lastLocation = (tool) => store.getLocal(`lastLocation:${tool}`);
export const setLastLocation = (tool, loc) => (loc ? store.setLocal(`lastLocation:${tool}`, loc) : null);

// QR labels for boxes/cupboards: "HBLOC:room:area[:spot]"
export const labelCode = (loc) => ['HBLOC', loc.roomId, loc.areaId, loc.spotId].filter(Boolean).join(':');
export function parseLabel(text) {
  const m = String(text || '').match(/HBLOC:([^:\s]+):([^:\s]+)(?::([^:\s]+))?/);
  return m ? { roomId: m[1], areaId: m[2], spotId: m[3] || '' } : null;
}

/** Room / Area / Spot chip picker. Returns { value }. */
export function locationPicker(container, initial, onChange) {
  let loc = normalize(initial);
  function normalize(l) {
    const rooms = allRooms();
    let room = l?.roomId ? getRoom(l.roomId) : null;
    if (!room && rooms.length === 1) room = rooms[0];
    if (!room) return { roomId: '', areaId: '', spotId: '' };
    let area = l?.areaId ? room.areas.find((a) => a.id === l.areaId) : null;
    if (!area && room.areas.length === 1) area = room.areas[0];
    const spot = area && l?.spotId ? area.spots.find((s) => s.id === l.spotId) : null;
    return { roomId: room.id, areaId: area?.id || '', spotId: spot?.id || '' };
  }
  function render() {
    const room = getRoom(loc.roomId);
    const area = room?.areas.find((a) => a.id === loc.areaId);
    container.innerHTML = `
      <div class="picker-row"><span class="field-label">Room</span><div class="chips">
        ${allRooms().map((r) => `<button type="button" class="chip" data-room="${esc(r.id)}" aria-pressed="${r.id === loc.roomId}">${esc(r.name)}</button>`).join('')}
        <button type="button" class="chip chip-add" data-add-room>${icon('plus')} Room</button></div></div>
      ${room ? `<div class="picker-row"><span class="field-label">Area / bookcase / cupboard</span><div class="chips">
        ${room.areas.map((a) => `<button type="button" class="chip" data-area="${esc(a.id)}" aria-pressed="${a.id === loc.areaId}">${esc(a.name)}</button>`).join('')}
        <button type="button" class="chip chip-add" data-add-area>${icon('plus')} Area</button></div></div>` : ''}
      ${area ? `<div class="picker-row"><span class="field-label">${esc(kindOf(area.kind).spot)} (optional)</span><div class="chips">
        ${area.spots.map((s) => `<button type="button" class="chip" data-spot="${esc(s.id)}" aria-pressed="${s.id === loc.spotId}">${esc(s.name)}</button>`).join('')}
        <button type="button" class="chip chip-add" data-add-spot aria-label="Add ${esc(kindOf(area.kind).spot)}">${icon('plus')}</button></div></div>` : ''}`;
  }
  const set = (p) => { loc = { ...loc, ...p }; render(); onChange?.(api.value); };
  container.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.room) { const r = getRoom(d.room); set({ roomId: r.id, areaId: r.areas.length === 1 ? r.areas[0].id : '', spotId: '' }); }
    else if (d.area) set({ areaId: d.area, spotId: '' });
    else if (d.spot) set({ spotId: loc.spotId === d.spot ? '' : d.spot });
    else if ('addRoom' in d) {
      const name = await promptDialog({ title: 'New room', placeholder: 'e.g. Living room', confirmLabel: 'Add room' });
      if (name) set({ roomId: (await addRoom(name)).id, areaId: '', spotId: '' });
    } else if ('addArea' in d) {
      const kind = await choose('What kind of area?', AREA_KINDS.map((k) => ({ label: k.label, value: k.id })), { columns: 2 });
      if (!kind) return;
      const name = await promptDialog({ title: `New ${kindOf(kind).label.toLowerCase()}`, placeholder: kind === 'bookcase' ? 'e.g. Tall bookcase' : 'e.g. Under-stairs cupboard', confirmLabel: 'Add' });
      if (name) set({ areaId: (await addArea(loc.roomId, name, kind, kind === 'bookcase' ? 5 : 0)).id, spotId: '' });
    } else if ('addSpot' in d) {
      const area = getArea(loc.roomId, loc.areaId);
      const k = kindOf(area.kind);
      const name = await promptDialog({ title: `New ${k.spot.toLowerCase()}`, value: `${k.spot} ${area.spots.length + 1}`, confirmLabel: 'Add' });
      if (name) set({ spotId: (await addSpot(loc.roomId, loc.areaId, name)).id });
    }
  });
  render();
  const api = { get value() { return loc.roomId ? { ...loc } : null; } };
  return api;
}

/** Create a starter room the first time (fixed ids so two devices don't duplicate it). */
export async function seedIfEmpty() {
  if (store.allRaw('rooms').length || store.getLocal('seededRooms')) return;
  await store.put('rooms', {
    id: 'seed-living', name: 'Living room', order: 1,
    areas: [{ id: 'seed-living-1', name: 'Bookcase', kind: 'bookcase', spots: [1, 2, 3, 4, 5].map((n) => ({ id: `seed-living-1-s${n}`, name: `Shelf ${n}` })) }],
  });
  await store.setLocal('seededRooms', true);
}
