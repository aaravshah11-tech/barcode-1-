// Settings › House locations: rooms → areas → shelves/boxes.
import * as store from '../core/store.js';
import * as L from '../core/locations.js';
import { esc, icon, promptDialog, confirmDialog, choose, plural } from '../core/ui.js';

export function renderLocations(root) {
  const draw = () => {
    const rooms = L.allRooms();
    root.innerHTML = `<div class="page-head"><h1>House locations</h1><a class="btn btn-sm" href="#/inventory/labels">${icon('print')} Print QR labels</a></div>
      <p class="muted">Library and Inventory share these. Room › Area (bookcase, cupboard…) › Shelf or box.</p>
      ${rooms.map((r) => `<div class="card room-card">
        <div class="room-head"><h3>${esc(r.name)}</h3><span class="small muted">${plural(L.countAt((l) => l.roomId === r.id), 'thing')}</span>
          <button class="icon-btn" data-rename-room="${esc(r.id)}" aria-label="Rename ${esc(r.name)}">${icon('edit')}</button>
          <button class="icon-btn" data-del-room="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">${icon('trash')}</button></div>
        ${r.areas.map((a) => `<div class="case-row">
            <div class="grow"><b>${esc(a.name)}</b> <span class="small muted">· ${esc(L.AREA_KINDS.find((k) => k.id === a.kind)?.label || 'Area')} · ${plural(L.countAt((l) => l.roomId === r.id && l.areaId === a.id), 'thing')}</span>
              <div class="chips" style="margin-top:6px">${a.spots.map((s) => `<button class="chip chip-sm" data-spot="${esc(r.id)}|${esc(a.id)}|${esc(s.id)}">${esc(s.name)}</button>`).join('')}
                <button class="chip chip-sm chip-add" data-add-spot="${esc(r.id)}|${esc(a.id)}">${icon('plus')}</button></div></div>
            <button class="icon-btn" data-rename-area="${esc(r.id)}|${esc(a.id)}" aria-label="Rename ${esc(a.name)}">${icon('edit')}</button>
            <button class="icon-btn" data-del-area="${esc(r.id)}|${esc(a.id)}" aria-label="Delete ${esc(a.name)}">${icon('trash')}</button></div>`).join('')}
        <button class="btn btn-ghost btn-sm" data-add-area="${esc(r.id)}">${icon('plus')} Add bookcase / cupboard / area</button>
      </div>`).join('')}
      <button class="btn btn-outline btn-block" data-add-room>${icon('plus')} Add room</button>`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    const sp = (v) => v.split('|');
    if ('addRoom' in d) {
      const n = await promptDialog({ title: 'New room', placeholder: 'e.g. Garage', confirmLabel: 'Add room' });
      if (n) await L.addRoom(n);
    } else if (d.renameRoom) {
      const n = await promptDialog({ title: 'Rename room', value: L.getRoom(d.renameRoom).name });
      if (n) await L.renameRoom(d.renameRoom, n);
    } else if (d.delRoom) {
      const r = L.getRoom(d.delRoom);
      const n = L.countAt((l) => l.roomId === r.id);
      if (await confirmDialog({ title: `Delete “${r.name}”?`, message: n ? `${plural(n, 'thing')} here will be set to “No location”. They aren’t deleted.` : 'This room is empty.', confirmLabel: 'Delete', danger: true })) await L.deleteRoom(r.id);
    } else if (d.addArea) {
      const kind = await choose('What kind of area?', L.AREA_KINDS.map((k) => ({ label: k.label, value: k.id })), { columns: 2 });
      if (!kind) return;
      const n = await promptDialog({ title: 'Name it', placeholder: kind === 'bookcase' ? 'e.g. Tall bookcase' : 'e.g. Hall cupboard', confirmLabel: 'Add' });
      if (!n) return;
      const count = kind === 'area' ? 0 : parseInt(await promptDialog({ title: `How many ${kind === 'storage' ? 'boxes' : 'shelves'}?`, value: kind === 'storage' ? '3' : '5', inputmode: 'numeric', confirmLabel: 'Done' }), 10) || 0;
      await L.addArea(d.addArea, n, kind, Math.min(count, 50));
    } else if (d.renameArea) {
      const [rid, aid] = sp(d.renameArea);
      const n = await promptDialog({ title: 'Rename', value: L.getArea(rid, aid).name });
      if (n) await L.updateArea(rid, aid, { name: n.trim() });
    } else if (d.delArea) {
      const [rid, aid] = sp(d.delArea);
      const a = L.getArea(rid, aid);
      const n = L.countAt((l) => l.areaId === aid);
      if (await confirmDialog({ title: `Delete “${a.name}”?`, message: n ? `${plural(n, 'thing')} here will be set to “No location”.` : 'It’s empty.', confirmLabel: 'Delete', danger: true })) await L.deleteArea(rid, aid);
    } else if (d.addSpot) {
      const [rid, aid] = sp(d.addSpot);
      const a = L.getArea(rid, aid);
      const word = a.kind === 'storage' ? 'Box' : a.kind === 'area' ? 'Spot' : 'Shelf';
      const n = await promptDialog({ title: `New ${word.toLowerCase()}`, value: `${word} ${a.spots.length + 1}`, confirmLabel: 'Add' });
      if (n) await L.addSpot(rid, aid, n);
    } else if (d.spot) {
      const [rid, aid, sid] = sp(d.spot);
      const s = L.getSpot(rid, aid, sid);
      const act = await choose(s.name, [{ label: 'Rename', value: 'rename' }, { label: 'Delete', value: 'delete' }]);
      if (act === 'rename') { const n = await promptDialog({ title: 'Rename', value: s.name }); if (n) await L.renameSpot(rid, aid, sid, n); }
      if (act === 'delete' && await confirmDialog({ title: `Delete “${s.name}”?`, confirmLabel: 'Delete', danger: true })) await L.deleteSpot(rid, aid, sid);
    }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'rooms') && !document.querySelector('.sheet-backdrop')) draw(); });
}
