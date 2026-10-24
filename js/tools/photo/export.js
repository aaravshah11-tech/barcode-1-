// Export picks into tidy folders with captions (CSV) and optional Lightroom XMP sidecars.
import * as store from '../../core/store.js';
import { player as getPlayer } from '../../core/people.js';
import { esc, icon, toast, plural, download } from '../../core/ui.js';
import { toCsv } from '../../core/csv.js';
import { match, sideName } from '../sports/common.js';
import { safeName, caption, xmpSidecar, sidecarName, momentLabel } from './match.js';
import { photosOf, momentsOf } from './data.js';
import { sessionFiles, canPickFolders, writeFile } from './files.js';
import { makeZip, ZIP_LIMIT } from './zip.js';

export function plan(matchId, { minRating = 0, picksOnly = true } = {}) {
  const m = match(matchId);
  const title = `${sideName(m, 'us')} v ${sideName(m, 'them')}`;
  const root = safeName(`${m.date || ''} ${title}`.trim());
  const moments = Object.fromEntries(momentsOf(matchId).map((x, i) => [x.id, { ...x, index: i + 1 }]));
  const chosen = photosOf(matchId).filter((p) => p.flag !== 'reject' && (picksOnly ? p.flag === 'pick' : true) && (p.rating || 0) >= minRating)
    .sort((a, b) => (a.cameraMs ?? 0) - (b.cameraMs ?? 0));
  return chosen.map((p) => {
    const mo = moments[p.momentId];
    const folder = mo ? safeName(`${String(mo.index).padStart(2, '0')} ${mo.name}`) : 'Other';
    const playerName = mo?.playerName || '';
    const cap = caption({ matchTitle: title, moment: mo, playerName });
    const keywords = [m.sport && m.sport[0].toUpperCase() + m.sport.slice(1), sideName(m, 'us'), sideName(m, 'them'), mo ? momentLabel(mo.type) : '', mo?.number ? `#${mo.number}` : '', playerName].filter(Boolean);
    return { photo: p, folder: `${root}/${folder}`, path: `${root}/${folder}/${p.name}`, caption: cap, keywords };
  });
}

export function renderExport(root, [id]) {
  const m = match(id);
  const opts = { picksOnly: true, minRating: 0, xmp: true };
  const draw = () => {
    const items = plan(id, opts);
    const missing = items.filter((x) => !sessionFiles.has(x.photo.id)).length;
    root.innerHTML = `<div class="page-head"><h1>Export picks</h1><a class="btn" href="#/photo/cull/${esc(id)}">${icon('back')} Cull</a></div>
      <div class="card">
        <label class="check-row"><input type="checkbox" data-o="picksOnly" ${opts.picksOnly ? 'checked' : ''}> Only photos marked <b>Pick</b></label>
        <label class="field"><span>Minimum stars</span><select data-o="minRating">${[0, 1, 2, 3, 4, 5].map((r) => `<option value="${r}" ${opts.minRating === r ? 'selected' : ''}>${r || 'Any'}</option>`).join('')}</select></label>
        <label class="check-row"><input type="checkbox" data-o="xmp" ${opts.xmp ? 'checked' : ''}> Write XMP sidecars (stars, keywords, caption) for Lightroom</label>
        <p class="small muted">Lightroom reads sidecars for RAW files. For JPEGs it reads the photo’s own metadata instead, so use the captions file.</p>
        <p><b>${plural(items.length, 'photo')}</b> into ${plural(new Set(items.map((x) => x.folder)).size, 'folder')}.${missing ? ` <span style="color:var(--warn)">${missing} need the photo folder reconnected (open Import or Cull).</span>` : ''}</p>
        <div class="btn-row">${canPickFolders() ? `<button class="btn btn-primary btn-lg" data-go ${items.length && !missing ? '' : 'disabled'}>${icon('folder')} Choose where to save…</button>` : ''}
          <button class="btn ${canPickFolders() ? '' : 'btn-primary btn-lg'}" data-zip ${items.length && !missing ? '' : 'disabled'}>${icon('download')} Download as ZIP</button>
          <button class="btn" data-csv ${items.length ? '' : 'disabled'}>${icon('download')} Captions (CSV)</button><button class="btn" data-txt ${items.length ? '' : 'disabled'}>${icon('download')} Captions (text)</button></div>
        ${canPickFolders() ? '<p class="small muted">The ZIP has the same folders, captions and sidecars — handy for sending to someone.</p>' : '<p class="small muted">This browser can’t save into folders, so your picks come as one ZIP file with the same folders inside.</p>'}
        <div data-progress class="mono small"></div>
      </div>
      <div class="section"><div class="section-title">Preview</div><div class="list">${items.slice(0, 40).map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.folder.split('/').pop())}</b> / ${esc(x.photo.name)}<div class="small muted">${esc(x.caption)}</div></div></div>`).join('') || '<div class="list-item muted">Nothing to export yet — pick some photos while culling.</div>'}</div></div>`;
  };
  const captionsCsv = (items) => toCsv([['Folder', (x) => x.folder], ['File', (x) => x.photo.name], ['Caption', (x) => x.caption], ['Keywords', (x) => x.keywords.join('; ')], ['Stars', (x) => x.photo.rating || ''], ['Pick', (x) => (x.photo.flag === 'pick' ? 'yes' : '')], ['Time', (x) => (x.photo.cameraMs ? new Date(x.photo.cameraMs).toISOString() : '')]], items);
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.o;
    if (!k) return;
    opts[k] = e.target.type === 'checkbox' ? e.target.checked : +e.target.value;
    draw();
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const items = plan(id, opts);
    const base = `${m.date || ''} ${sideName(m, 'us')} v ${sideName(m, 'them')}`;
    if ('csv' in b.dataset) download(`${safeName(base)} captions.csv`, '﻿' + captionsCsv(items), 'text/csv;charset=utf-8');
    if ('txt' in b.dataset) download(`${safeName(base)} captions.txt`, items.map((x) => `${x.photo.name}\t${x.caption}`).join('\n'), 'text/plain');
    if ('zip' in b.dataset) {
      const prog = root.querySelector('[data-progress]');
      // Split into parts under 4 GB (the ZIP format limit).
      const parts = [[]];
      let size = 0;
      for (const x of items) {
        const f = sessionFiles.get(x.photo.id);
        if (!f) continue;
        if (size + f.size > ZIP_LIMIT * 0.95 && parts.at(-1).length) { parts.push([]); size = 0; }
        parts.at(-1).push(x); size += f.size;
      }
      b.disabled = true;
      try {
        for (let p = 0; p < parts.length; p++) {
          const entries = [];
          for (const x of parts[p]) {
            entries.push({ name: x.path, data: sessionFiles.get(x.photo.id), date: x.photo.cameraMs ? new Date(x.photo.cameraMs) : new Date() });
            if (opts.xmp) entries.push({ name: `${x.folder}/${sidecarName(x.photo.name)}`, data: xmpSidecar({ rating: x.photo.rating, keywords: x.keywords, caption: x.caption, pick: x.photo.flag === 'pick' }) });
          }
          entries.push({ name: `${parts[p][0].path.split('/')[0]}/captions.csv`, data: '\ufeff' + captionsCsv(parts[p]) });
          const zip = await makeZip(entries, { onProgress: (d, t) => { prog.textContent = `Packing${parts.length > 1 ? ` part ${p + 1}/${parts.length}` : ''}… ${d}/${t}`; } });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(zip);
          a.download = `${safeName(base)}${parts.length > 1 ? ` part ${p + 1}` : ''}.zip`;
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
        }
        prog.textContent = `Done: ${plural(items.length, 'photo')} in ${parts.length > 1 ? `${parts.length} ZIP files` : 'a ZIP file'}.`;
        toast('ZIP downloaded', { kind: 'ok' });
      } catch (x) { prog.textContent = `Stopped: ${x.message}`; toast(x.message, { kind: 'err' }); }
      b.disabled = false;
    }
    if ('go' in b.dataset) {
      let dir;
      try { dir = await window.showDirectoryPicker({ id: 'homebase-export', mode: 'readwrite' }); } catch (x) { if (x.name !== 'AbortError') toast(x.message, { kind: 'err' }); return; }
      const prog = root.querySelector('[data-progress]');
      let n = 0;
      try {
        for (const x of items) {
          const f = sessionFiles.get(x.photo.id);
          if (!f) continue;
          await writeFile(dir, x.path, f);
          if (opts.xmp) await writeFile(dir, `${x.folder}/${sidecarName(x.photo.name)}`, xmpSidecar({ rating: x.photo.rating, keywords: x.keywords, caption: x.caption, pick: x.photo.flag === 'pick' }));
          prog.textContent = `Copied ${++n}/${items.length}…`;
        }
        await writeFile(dir, `${items[0].path.split('/')[0]}/captions.csv`, '﻿' + captionsCsv(items));
        prog.textContent = `Done: ${plural(n, 'photo')} copied with captions.csv.`;
        toast(`Exported ${plural(n, 'photo')}`, { kind: 'ok' });
      } catch (x) { prog.textContent = `Stopped: ${x.message}`; toast('Export failed — is there enough disk space and permission?', { kind: 'err' }); }
    }
  });
  draw();
  void store; void getPlayer;
}
