// Settings: rooms & bookcases, family, linking, backup, appearance.
import * as store from '../store.js';
import * as link from '../sync/peer-link.js';
import * as backup from '../backup.js';
import { esc, icon, promptDialog, confirmDialog, toast, plural } from '../ui.js';
import { fillPendingLookups } from '../pending.js';

export function render(root) {
  function draw() {
    const rooms = store.allRooms();
    const st = link.getState();
    const theme = (() => { try { return localStorage.getItem('shelf.theme') || 'auto'; } catch { return 'auto'; } })();
    const pending = store.allBooks().filter((b) => b.needsLookup).length;
    const linkText = st.role === 'host' ? (st.state === 'connected' ? `Linked with ${st.devices.join(', ')}` : 'Waiting for your phone')
      : st.role === 'guest' ? (st.state === 'connected' ? 'Linked to your computer' : 'Reconnecting…') : 'Scan on your phone, see books on your computer';
    root.innerHTML = `<h1>Settings</h1>

      <div class="section"><div class="section-title">Phone & computer</div>
        <div class="list"><a class="list-item" href="#/link">${icon('link')}<div class="grow"><b>Link phone & computer</b><div class="small muted">${esc(linkText)}</div></div>${icon('chev', 'chev')}</a></div>
      </div>

      <div class="section"><div class="section-title">Rooms & bookcases</div>
        ${rooms.map((r) => `<div class="card room-card">
          <div class="room-head"><h3>${esc(r.name)}</h3><span class="small muted">${plural(store.countBooksAt((l) => l.roomId === r.id), 'book')}</span>
            <button class="icon-btn" data-rename-room="${esc(r.id)}" aria-label="Rename ${esc(r.name)}">${icon('edit')}</button>
            <button class="icon-btn" data-del-room="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">${icon('trash')}</button></div>
          ${r.cases.map((c) => `<div class="case-row"><div class="grow">${esc(c.name)} <span class="small muted">· ${c.shelves || 0} shelves · ${plural(store.countBooksAt((l) => l.roomId === r.id && l.caseId === c.id), 'book')}</span></div>
            <button class="icon-btn" data-shelves="${esc(r.id)}|${esc(c.id)}" aria-label="Number of shelves">#</button>
            <button class="icon-btn" data-rename-case="${esc(r.id)}|${esc(c.id)}" aria-label="Rename ${esc(c.name)}">${icon('edit')}</button>
            <button class="icon-btn" data-del-case="${esc(r.id)}|${esc(c.id)}" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button></div>`).join('')}
          <button class="btn btn-ghost btn-sm" data-add-case="${esc(r.id)}">${icon('plus')} Add bookcase / area</button>
        </div>`).join('')}
        <button class="btn btn-outline btn-block" data-add-room>${icon('plus')} Add room</button>
      </div>

      <div class="section"><div class="section-title">Family members</div>
        <div class="card"><div class="chips">${store.owners().map((o) => `<button class="chip" data-del-owner="${esc(o)}" aria-label="Remove ${esc(o)}">${esc(o)} ${icon('close')}</button>`).join('') || '<span class="muted small">No one added yet.</span>'}</div>
        <button class="btn btn-ghost btn-sm" data-add-owner style="margin-top:10px">${icon('plus')} Add person</button></div>
      </div>

      <div class="section"><div class="section-title">Backup</div>
        <div class="card">
          <p class="small muted">Your library is stored on this device. Download a backup now and then — especially before clearing your browser.</p>
          <div class="btn-row">
            <button class="btn" data-export-json>${icon('download')} Backup (JSON)</button>
            <button class="btn" data-export-csv>${icon('download')} Spreadsheet (CSV)</button>
          </div>
          <label class="btn btn-outline btn-block" style="margin-top:10px">${icon('upload')} Import a JSON backup
            <input type="file" accept="application/json,.json" data-import hidden></label>
          ${pending ? `<button class="btn btn-ghost btn-block" data-fill style="margin-top:10px">${icon('refresh')} Fetch details for ${plural(pending, 'book')} added offline</button>` : ''}
        </div>
      </div>

      <div class="section"><div class="section-title">Scanning</div>
        <div class="list">
          <label class="list-item"><div class="grow">Beep on scan</div><input type="checkbox" data-pref="sound" ${store.getSetting('sound', true) ? 'checked' : ''}></label>
          <label class="list-item"><div class="grow">Vibrate on scan <div class="small muted">Android only — iPhones don’t allow it</div></div><input type="checkbox" data-pref="vibrate" ${store.getSetting('vibrate', true) ? 'checked' : ''}></label>
        </div>
      </div>

      <div class="section"><div class="section-title">Appearance</div>
        <div class="segmented" role="group" aria-label="Theme">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-theme="${v}" aria-pressed="${v === theme}">${l}</button>`).join('')}</div>
      </div>

      <div class="section"><div class="section-title">Danger zone</div>
        <button class="btn btn-danger btn-block" data-erase>${icon('trash')} Erase the whole library</button>
      </div>
      <p class="muted small center" style="margin-top:24px">Shelf · ${plural(store.allBooks().length, 'book')} · data stays on your devices</p>`;
  }

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.pref) await store.setSetting(t.dataset.pref, t.checked);
    if ('import' in t.dataset && t.files?.[0]) {
      try {
        const n = await backup.importJsonFile(t.files[0]);
        toast(n ? `Imported ${plural(n, 'record')}` : 'Nothing new to import — you already have everything in that file.', { kind: 'ok', timeout: 5000 });
      } catch (err) {
        toast(err.message, { kind: 'err', timeout: 6000 });
      }
      t.value = '';
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    const split = (v) => v.split('|');
    if ('addRoom' in d) {
      const name = await promptDialog({ title: 'New room', placeholder: 'e.g. Bedroom', confirmLabel: 'Add room' });
      if (name) await store.addRoom(name);
    } else if (d.renameRoom) {
      const r = store.getRoom(d.renameRoom);
      const name = await promptDialog({ title: 'Rename room', value: r.name });
      if (name) await store.renameRoom(r.id, name);
    } else if (d.delRoom) {
      const r = store.getRoom(d.delRoom);
      const n = store.countBooksAt((l) => l.roomId === r.id);
      if (await confirmDialog({ title: `Delete “${r.name}”?`, message: n ? `${plural(n, 'book')} here will be set to “No location”. The books themselves are kept.` : 'This room is empty.', confirmLabel: 'Delete room', danger: true })) await store.deleteRoom(r.id);
    } else if (d.addCase) {
      const name = await promptDialog({ title: 'New bookcase or area', placeholder: 'e.g. Tall bookcase', confirmLabel: 'Add' });
      if (name) await store.addCase(d.addCase, name);
    } else if (d.renameCase) {
      const [rid, cid] = split(d.renameCase);
      const c = store.getCase(rid, cid);
      const name = await promptDialog({ title: 'Rename bookcase', value: c.name });
      if (name) await store.updateCase(rid, cid, { name: name.trim() });
    } else if (d.shelves) {
      const [rid, cid] = split(d.shelves);
      const c = store.getCase(rid, cid);
      const v = await promptDialog({ title: `How many shelves does “${c.name}” have?`, value: String(c.shelves || 5), inputmode: 'numeric' });
      const num = parseInt(v, 10);
      if (num > 0 && num < 100) await store.updateCase(rid, cid, { shelves: num });
    } else if (d.delCase) {
      const [rid, cid] = split(d.delCase);
      const c = store.getCase(rid, cid);
      const n = store.countBooksAt((l) => l.roomId === rid && l.caseId === cid);
      if (await confirmDialog({ title: `Delete “${c.name}”?`, message: n ? `${plural(n, 'book')} here will be set to “No location”.` : 'It’s empty.', confirmLabel: 'Delete', danger: true })) await store.deleteCase(rid, cid);
    } else if ('addOwner' in d) {
      const name = await promptDialog({ title: 'Add a family member', placeholder: 'Name', confirmLabel: 'Add' });
      if (name) await store.addOwner(name);
    } else if (d.delOwner) {
      if (await confirmDialog({ title: `Remove ${d.delOwner}?`, message: 'Books keep their owner name; they just won’t be offered as a choice.', confirmLabel: 'Remove' })) await store.removeOwner(d.delOwner);
    } else if ('exportJson' in d) {
      toast(`Downloaded backup of ${plural(backup.exportJson(), 'book')}`, { kind: 'ok' });
    } else if ('exportCsv' in d) {
      toast(`Downloaded spreadsheet of ${plural(backup.exportCsv(), 'book')}`, { kind: 'ok' });
    } else if ('fill' in d) {
      t.disabled = true;
      const n = await fillPendingLookups();
      toast(n ? `Updated ${plural(n, 'book')}` : 'Couldn’t fetch details — are you online?', { kind: n ? 'ok' : 'warn' });
    } else if (d.theme) {
      try { localStorage.setItem('shelf.theme', d.theme); } catch { /* ignore */ }
      if (d.theme === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = d.theme;
      draw();
    } else if ('erase' in d) {
      const st = link.getState();
      if (await confirmDialog({
        title: 'Erase everything?',
        message: `This deletes all ${plural(store.allBooks().length, 'book')} and rooms${st.state === 'connected' ? ' — on your linked devices too' : ''}. Download a backup first if you might want them back.`,
        confirmLabel: 'Erase library', danger: true,
      })) { await store.eraseAll(); toast('Library erased'); }
    }
  });

  draw();
  const off1 = store.onChange(() => { if (!document.querySelector('.sheet-backdrop')) draw(); });
  const off2 = link.onState(draw);
  return () => { off1(); off2(); };
}
