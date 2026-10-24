// Room → Bookcase → Shelf picker made of big tappable chips.
import * as store from '../store.js';
import { esc, icon, promptDialog } from '../ui.js';

/**
 * Render a location picker into `container`.
 * @returns {{ get value(): {roomId, caseId, shelf} | null }}
 */
export function locationPicker(container, initial, onChange) {
  let loc = normalize(initial);

  function normalize(l) {
    const rooms = store.allRooms();
    let room = l?.roomId ? store.getRoom(l.roomId) : null;
    if (!room && rooms.length === 1) room = rooms[0];
    if (!room) return { roomId: '', caseId: '', shelf: '' };
    let bc = l?.caseId ? room.cases.find((c) => c.id === l.caseId) : null;
    if (!bc && room.cases.length === 1) bc = room.cases[0];
    return { roomId: room.id, caseId: bc?.id || '', shelf: bc && l?.shelf != null && l.caseId === bc.id ? String(l.shelf) : '' };
  }

  function render() {
    const rooms = store.allRooms();
    const room = store.getRoom(loc.roomId);
    const bc = room?.cases.find((c) => c.id === loc.caseId);
    const shelfCount = Math.max(bc?.shelves || 0, +loc.shelf || 0);
    container.innerHTML = `
      <div class="picker-row"><span class="field-label">Room</span><div class="chips">
        ${rooms.map((r) => `<button type="button" class="chip" data-room="${esc(r.id)}" aria-pressed="${r.id === loc.roomId}">${esc(r.name)}</button>`).join('')}
        <button type="button" class="chip chip-add" data-add-room>${icon('plus')} Room</button>
      </div></div>
      ${room ? `<div class="picker-row"><span class="field-label">Bookcase / area</span><div class="chips">
        ${room.cases.map((c) => `<button type="button" class="chip" data-case="${esc(c.id)}" aria-pressed="${c.id === loc.caseId}">${esc(c.name)}</button>`).join('')}
        <button type="button" class="chip chip-add" data-add-case>${icon('plus')} Bookcase</button>
      </div></div>` : ''}
      ${bc ? `<div class="picker-row"><span class="field-label">Shelf</span><div class="chips">
        ${Array.from({ length: shelfCount }, (_, i) => String(i + 1)).map((s) => `<button type="button" class="chip" data-shelf="${s}" aria-pressed="${s === loc.shelf}" aria-label="Shelf ${s}">${s}</button>`).join('')}
        ${loc.shelf && !/^\d+$/.test(loc.shelf) ? `<button type="button" class="chip" data-shelf="${esc(loc.shelf)}" aria-pressed="true">${esc(loc.shelf)}</button>` : ''}
        <button type="button" class="chip chip-add" data-add-shelf aria-label="Add a shelf">${icon('plus')}</button>
      </div></div>` : ''}`;
  }

  const set = (patch) => {
    loc = { ...loc, ...patch };
    render();
    onChange?.(api.value);
  };

  container.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.room) {
      const room = store.getRoom(b.dataset.room);
      set({ roomId: room.id, caseId: room.cases.length === 1 ? room.cases[0].id : '', shelf: '' });
    } else if (b.dataset.case) {
      set({ caseId: b.dataset.case, shelf: '' });
    } else if (b.dataset.shelf) {
      set({ shelf: loc.shelf === b.dataset.shelf ? '' : b.dataset.shelf });
    } else if ('addRoom' in b.dataset) {
      const name = await promptDialog({ title: 'New room', placeholder: 'e.g. Living room', confirmLabel: 'Add room' });
      if (name) {
        const r = await store.addRoom(name);
        set({ roomId: r.id, caseId: '', shelf: '' });
      }
    } else if ('addCase' in b.dataset) {
      const name = await promptDialog({ title: 'New bookcase or area', placeholder: 'e.g. Tall bookcase', confirmLabel: 'Add' });
      if (name) {
        const c = await store.addCase(loc.roomId, name);
        set({ caseId: c.id, shelf: '' });
      }
    } else if ('addShelf' in b.dataset) {
      const bc = store.getCase(loc.roomId, loc.caseId);
      const next = (bc?.shelves || 0) + 1;
      await store.updateCase(loc.roomId, loc.caseId, { shelves: next });
      set({ shelf: String(next) });
    }
  });

  render();
  const api = {
    get value() {
      return loc.roomId ? { roomId: loc.roomId, caseId: loc.caseId, shelf: loc.shelf } : null;
    },
  };
  return api;
}
