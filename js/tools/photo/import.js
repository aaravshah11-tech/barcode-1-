// Import a folder of photos, sync the camera clock, and auto-sort photos into moments.
import * as store from '../../core/store.js';
import { esc, icon, toast, plural, formatDate } from '../../core/ui.js';
import { match, sideName } from '../sports/common.js';
import { parseClockQr, clockOffset, shownTimeFromText, matchPhotos, bursts, trueTime } from './match.js';
import { shoot, saveShoot, photosOf, photoId, momentsOf } from './data.js';
import { canPickFolders, walk, saveHandle, readExifTime, decodeQr, thumbUrl, sessionFiles, IMAGE_RE } from './files.js';
import { offsetText } from './touchline.js';

/** Re-run matching for a match's photo records (after changing the window or offset). */
export async function resort(matchId) {
  const sh = shoot(matchId);
  const moments = momentsOf(matchId);
  const photos = photosOf(matchId).map((p) => ({ ...p, takenAt: p.cameraMs != null ? trueTime(p.cameraMs, sh.offsetMs) : null }));
  const map = matchPhotos(photos, moments, (sh.windowS || 15) * 1000);
  const b = bursts(photos);
  const byId = Object.fromEntries(moments.map((x) => [x.id, x]));
  const changed = photos.filter((p) => {
    const mid = map.get(p.id) || '';
    return p.momentId !== mid || p.takenAt !== store.get('photos', p.id)?.takenAt || p.burst !== (b.get(p.id) ?? null);
  }).map((p) => {
    const mo = byId[map.get(p.id)] || null;
    return { ...p, momentId: mo?.id || '', momentType: mo?.type || '', number: mo?.number || '', burst: b.get(p.id) ?? null };
  });
  if (changed.length) await store.putMany('photos', changed);
  return { moments: moments.length, matched: [...map.values()].filter(Boolean).length, total: photos.length };
}

export function renderImport(root, [id]) {
  const m = match(id);
  if (!m) { root.innerHTML = '<div class="empty"><h2>Match not found</h2></div>'; return; }
  let files = []; // [{ id, path, file, cameraMs, camera }]
  let stage = photosOf(id).length ? 'done' : 'pick';
  let progress = '';
  let clockMsg = '';

  const draw = () => {
    const sh = shoot(id);
    const photos = photosOf(id);
    const moments = momentsOf(id);
    const noTime = photos.filter((p) => p.cameraMs == null).length;
    const groups = moments.map((mo) => [mo, photos.filter((p) => p.momentId === mo.id).length]).filter(([, n]) => n);
    const unsorted = photos.filter((p) => !p.momentId && p.cameraMs != null).length;
    root.innerHTML = `<div class="page-head"><h1>Import & auto-sort</h1><a class="btn" href="#/photo/match/${esc(id)}">${icon('back')} Match</a></div>
      <p class="muted">${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))} · ${esc(formatDate(m.date))}. Photos stay on this computer — only their names, times and ratings are saved.</p>
      <div class="card"><h2>1. Choose the photo folder</h2>
        ${canPickFolders() ? `<button class="btn btn-primary btn-lg" data-pick>${icon('folder')} Choose folder…</button>`
          : `<label class="btn btn-primary btn-lg">${icon('folder')} Choose folder…<input type="file" data-input webkitdirectory multiple hidden></label>
             <p class="small muted">Tip: Chrome or Edge on a computer can also save your picks into folders for you.</p>`}
        <label class="btn btn-ghost btn-sm" style="margin-top:6px">…or pick individual files<input type="file" data-input multiple accept="image/*,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.dng" hidden></label>
        ${progress ? `<p class="mono small" data-progress>${esc(progress)}</p>` : ''}
        ${photos.length ? `<p class="small">${plural(photos.length, 'photo')} imported${noTime ? ` · <b style="color:var(--warn)">${noTime} without a time in their EXIF</b> (they go in “No time info”)` : ''}.</p>` : ''}
      </div>
      <div class="card"><h2>2. Camera clock</h2>
        <p>${sh.offsetMs || sh.offsetFrom ? `Your camera was <b>${esc(offsetText(sh.offsetMs))}</b>${sh.offsetFrom ? ` (from ${esc(sh.offsetFrom)})` : ''}.` : 'Not synced yet. Take a photo of the HomeBase clock on your phone, include it in the folder, then:'}</p>
        ${clockMsg ? `<div class="banner ${/Found|Synced/.test(clockMsg) ? 'banner-ok' : 'banner-warn'}">${icon('clock')}<div class="grow">${esc(clockMsg)}</div></div>` : ''}
        <div class="btn-row"><button class="btn" data-find-clock ${files.length || sessionFiles.size ? '' : 'disabled'}>${icon('qr')} Find the clock photo</button><button class="btn" data-manual-clock ${photos.length ? '' : 'disabled'}>${icon('edit')} Enter it by hand</button></div>
        <div data-manual></div>
      </div>
      <div class="card"><h2>3. Sorted into moments</h2>
        <label class="field"><span>Match window: ±<b data-wv>${sh.windowS || 15}</b> seconds around each tag</span><input type="range" min="1" max="60" step="1" value="${sh.windowS || 15}" data-window></label>
        <p class="small muted">${plural(moments.length, 'moment')} (tags + live stats). Photos are matched to the nearest moment within the window.</p>
        ${photos.length ? `<div class="list">${groups.map(([mo, n]) => `<div class="list-item"><div class="grow"><b>${esc(mo.name)}</b>${mo.playerName ? ` <span class="muted small">${esc(mo.playerName)}</span>` : ''}</div><span class="badge">${n}</span></div>`).join('')}
          <div class="list-item"><div class="grow muted">Not near any moment</div><span class="badge" style="background:var(--muted)">${unsorted}</span></div>
          ${noTime ? `<div class="list-item"><div class="grow muted">No time info (no EXIF)</div><span class="badge" style="background:var(--warn)">${noTime}</span></div>` : ''}</div>
          <a class="btn btn-primary btn-lg btn-block" href="#/photo/cull/${esc(id)}" style="margin-top:12px">${icon('star')} Start culling</a>` : '<p class="muted">Import photos first.</p>'}
      </div>`;
  };

  async function load(entries, handle) {
    stage = 'reading';
    files = [];
    const imgs = entries.filter((e) => IMAGE_RE.test(e.path));
    if (!imgs.length) { toast('No photos found in that folder.', { kind: 'warn' }); return draw(); }
    let done = 0;
    const queue = [...imgs];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift();
        const t = await readExifTime(e.file);
        files.push({ id: photoId(id, e.path), path: e.path, file: e.file, cameraMs: t?.cameraMs ?? null, camera: t?.camera || '' });
        sessionFiles.set(photoId(id, e.path), e.file);
        if (++done % 10 === 0 || done === imgs.length) { progress = `Reading photo times… ${done}/${imgs.length}`; const el = root.querySelector('[data-progress]'); if (el) el.textContent = progress; else draw(); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (handle) await saveHandle(id, handle);
    // Save references (keep ratings/flags from an earlier import).
    await store.putMany('photos', files.map((f) => {
      const prev = store.get('photos', f.id) || {};
      return { rating: 0, flag: '', ...prev, id: f.id, matchId: id, path: f.path, name: f.file.name, size: f.file.size, cameraMs: f.cameraMs, camera: f.camera };
    }));
    progress = `Read ${plural(files.length, 'photo')}.`;
    stage = 'done';
    if (!shoot(id).offsetFrom) await findClock();
    await resort(id);
    draw();
  }

  async function findClock() {
    const pool = (files.length ? files : photosOf(id).map((p) => ({ ...p, file: sessionFiles.get(p.id) })).filter((x) => x.file)).filter((f) => f.cameraMs != null).sort((a, b) => a.cameraMs - b.cameraMs);
    const cands = [...pool.slice(0, 25), ...pool.slice(-25)].filter((v, i, a) => a.indexOf(v) === i);
    clockMsg = `Looking for the clock photo in ${cands.length} photos…`;
    draw();
    for (const f of cands) {
      const shown = parseClockQr(await decodeQr(f.file));
      if (shown) {
        const off = clockOffset(f.cameraMs, shown);
        await saveShoot(id, { offsetMs: off, offsetFrom: f.path });
        clockMsg = `Found it in ${f.path}: your camera is ${offsetText(off)}. Synced!`;
        await resort(id);
        return draw();
      }
    }
    clockMsg = 'No clock photo found. If you took one, enter the time shown on it by hand.';
    draw();
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('pick' in b.dataset) {
      try {
        const handle = await window.showDirectoryPicker({ id: 'homebase-photos', mode: 'read' });
        progress = 'Finding photos…'; draw();
        await load(await walk(handle), handle);
      } catch (x) { if (x.name !== 'AbortError') toast(x.message, { kind: 'err' }); }
    } else if ('findClock' in b.dataset) findClock();
    else if ('manualClock' in b.dataset) {
      const cands = photosOf(id).filter((p) => p.cameraMs != null).sort((a, b2) => a.cameraMs - b2.cameraMs).slice(0, 30);
      const el = root.querySelector('[data-manual]');
      el.innerHTML = `<p class="small">Pick the photo of the clock, then type the time it shows.</p><div class="strip">${cands.map((p) => `<button class="strip-item" data-cand="${esc(p.id)}"><img data-thumb="${esc(p.id)}" alt=""><span>${esc(p.name)}</span></button>`).join('')}</div>
        <form data-manual-form style="display:flex;gap:8px;margin-top:8px"><input name="shown" placeholder="e.g. 14:32:07" required><button class="btn btn-primary">Set</button></form>`;
      for (const p of cands) { const f = sessionFiles.get(p.id); if (f) thumbUrl(p.id, f, 200).then((u) => { const img = el.querySelector(`[data-thumb="${CSS.escape(p.id)}"]`); if (img && u) img.src = u; }); }
    } else if (b.dataset.cand) {
      root.querySelectorAll('[data-cand]').forEach((x) => x.classList.toggle('on', x === b));
    }
  });
  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-manual-form]')) return;
    e.preventDefault();
    const chosen = root.querySelector('[data-cand].on')?.dataset.cand;
    const p = chosen && store.get('photos', chosen);
    if (!p) { toast('Tap the clock photo first.', { kind: 'warn' }); return; }
    const shown = shownTimeFromText(e.target.shown.value, p.cameraMs);
    if (shown == null) { toast('Type the time like 14:32:07', { kind: 'warn' }); return; }
    const off = clockOffset(p.cameraMs, shown);
    await saveShoot(id, { offsetMs: off, offsetFrom: `${p.name} (typed)` });
    clockMsg = `Synced: your camera is ${offsetText(off)}.`;
    await resort(id);
    draw();
  });
  root.addEventListener('change', async (e) => {
    if (e.target.matches('[data-input]') && e.target.files?.length) {
      const entries = [...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
      progress = 'Reading…'; draw();
      await load(entries, null);
    }
    if (e.target.matches('[data-window]')) { await saveShoot(id, { windowS: +e.target.value }); await resort(id); draw(); }
  });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-window]')) root.querySelector('[data-wv]').textContent = e.target.value; });
  draw();
  return store.onChange(({ changes }) => { if (stage !== 'reading' && changes.some((c) => c.c === 'photoTags' || c.c === 'events') && !root.contains(document.activeElement)) resort(id).then(draw); });
}
