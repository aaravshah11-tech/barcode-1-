// Settings › Backup & export.
import * as store from '../core/store.js';
import { TOOLS, loadTool } from '../tools.js';
import { esc, icon, toast, download, confirmDialog, plural } from '../core/ui.js';

export async function importBackupText(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn’t a valid JSON backup.'); }
  if (data?.app === 'homebase' && data.data) return store.importAll(data.data);
  // Old Shelf backup: { app:'shelf', books, rooms, owners }
  if (data?.app === 'shelf' || (Array.isArray(data?.books) && !data.data)) {
    const rooms = (data.rooms || []).map((r) => ({ id: r.id, name: r.name, order: r.order,
      areas: (r.cases || r.areas || []).map((c) => c.spots ? c : ({ id: c.id, name: c.name, kind: 'bookcase', spots: Array.from({ length: c.shelves || 0 }, (_, i) => ({ id: `${c.id}-s${i + 1}`, name: `Shelf ${i + 1}` })) })) }));
    const books = (data.books || []).map((b) => {
      const l = b.location;
      const loc = l?.roomId ? (l.areaId !== undefined ? l : { roomId: l.roomId, areaId: l.caseId || '', spotId: l.caseId && /^\d+$/.test(String(l.shelf || '')) ? `${l.caseId}-s${l.shelf}` : '' }) : null;
      return { ...b, location: loc };
    });
    const n = await store.importAll({ rooms, books });
    if (Array.isArray(data.owners)) await store.setSetting('family', [...new Set([...store.setting('family', []), ...data.owners])]);
    return n;
  }
  throw new Error('No HomeBase data found in that file.');
}

export function renderBackup(root) {
  const draw = async () => {
    const counts = store.collections().map((c) => [c, store.all(c).length]).filter(([, n]) => n);
    const tools = [];
    for (const t of TOOLS) {
      try { const m = await loadTool(t.id); if (m?.exports?.length) tools.push([t, m.exports]); } catch { /* tool failed to load */ }
    }
    root.innerHTML = `<h1>Backup & export</h1>
      <div class="card"><h2>Everything (JSON)</h2>
        <p class="small muted">One file with all tools’ data. Use it to back up or move to a new device. Photos from Match Photography stay on your computer; only their ratings and tags are included.</p>
        <p class="small">${counts.map(([c, n]) => `${esc(c)}: <b>${n}</b>`).join(' · ') || 'Nothing saved yet.'}</p>
        <div class="btn-row"><button class="btn btn-primary" data-export>${icon('download')} Download backup</button>
        <label class="btn btn-outline">${icon('upload')} Import backup<input type="file" accept="application/json,.json" data-import hidden></label></div>
        <p class="small muted" style="margin-top:8px">Importing merges with what’s here (newest version of each thing wins). Old Shelf backups work too.</p>
      </div>
      <div class="section"><div class="section-title">Spreadsheets (CSV) per tool</div>
        <div class="list">${tools.flatMap(([t, exps]) => exps.map((x, i) => `<button class="list-item" data-csv="${t.id}|${i}"><span style="font-size:1.4rem">${t.emoji}</span><div class="grow"><b>${esc(x.label)}</b></div>${icon('download')}</button>`)).join('')}</div>
      </div>
      <div class="section"><div class="section-title">Danger zone</div>
        <button class="btn btn-danger btn-block" data-erase>${icon('trash')} Erase all data</button></div>`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('export' in b.dataset) {
      const data = store.exportAll();
      download(`homebase-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'homebase', version: 1, exportedAt: new Date().toISOString(), data }, null, 1), 'application/json');
      toast('Backup downloaded', { kind: 'ok' });
    } else if (b.dataset.csv) {
      const [id, i] = b.dataset.csv.split('|');
      const m = await loadTool(id);
      const n = await m.exports[+i].run();
      toast(`Downloaded ${plural(n || 0, 'row')}`, { kind: 'ok' });
    } else if ('erase' in b.dataset) {
      if (await confirmDialog({ title: 'Erase everything?', message: 'Deletes all data from every tool on this device — and on your paired devices / cloud too. Download a backup first!', confirmLabel: 'Erase all', danger: true })) {
        await store.eraseCollections(store.collections());
        toast('All data erased');
        draw();
      }
    }
  });
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (!('import' in t.dataset) || !t.files?.[0]) return;
    try {
      const n = await importBackupText(await t.files[0].text());
      toast(n ? `Imported ${plural(n, 'record')}` : 'Nothing new — you already have everything in that file.', { kind: 'ok', timeout: 5000 });
      draw();
    } catch (err) { toast(err.message, { kind: 'err', timeout: 6000 }); }
    t.value = '';
  });
  draw();
}
