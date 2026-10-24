// Culling gallery: fast grid + full-screen viewer with keyboard shortcuts.
import * as store from '../../core/store.js';
import { esc, icon, toast, plural } from '../../core/ui.js';
import { match } from '../sports/common.js';
import { photosOf, momentsOf } from './data.js';
import { sessionFiles, thumbUrl, fullUrl, getHandle, ensurePermission, walk } from './files.js';
import { photoId } from './data.js';

const KEYS = '← → move · 1–5 stars · 0 clear · P pick · X reject · U unflag · C compare burst · Esc close';

export function renderCull(root, [id], ctx) {
  const m = match(id);
  const st = { group: 'all', flag: 'all', minRating: 0, number: '', viewer: null, compare: false, focus: 0 };
  let list = [];

  const groups = () => {
    const ms = momentsOf(id);
    const ph = photosOf(id);
    return [['all', 'All photos', ph.length], ...ms.map((x) => [x.id, x.name, ph.filter((p) => p.momentId === x.id).length]).filter((g) => g[2]),
      ['none', 'Not near a moment', ph.filter((p) => !p.momentId && p.cameraMs != null).length], ['notime', 'No time info', ph.filter((p) => p.cameraMs == null).length]].filter((g) => g[2] || g[0] === 'all');
  };
  const filtered = () => photosOf(id).filter((p) => (st.group === 'all' || (st.group === 'none' ? !p.momentId && p.cameraMs != null : st.group === 'notime' ? p.cameraMs == null : p.momentId === st.group))
    && (st.flag === 'all' || (st.flag === 'unflagged' ? !p.flag : p.flag === st.flag)) && (p.rating || 0) >= st.minRating && (!st.number || String(p.number) === st.number))
    .sort((a, b) => (a.cameraMs ?? Infinity) - (b.cameraMs ?? Infinity) || a.path.localeCompare(b.path));

  const missingFiles = () => photosOf(id).length && !photosOf(id).some((p) => sessionFiles.has(p.id));

  const draw = () => {
    list = filtered();
    const all = photosOf(id);
    const picks = all.filter((p) => p.flag === 'pick').length, rejects = all.filter((p) => p.flag === 'reject').length;
    const numbers = [...new Set(all.map((p) => p.number).filter(Boolean))].sort((a, b) => a - b);
    root.innerHTML = `<div class="page-head"><h1>Cull</h1><span class="small muted">${plural(all.length, 'photo')} · <b>${picks}</b> picks · ${rejects} rejects</span>
        <a class="btn" href="#/photo/import/${esc(id)}">${icon('folder')} Import</a><a class="btn btn-primary" href="#/photo/export/${esc(id)}">${icon('upload')} Export picks</a></div>
      ${!all.length ? '<div class="empty"><div class="art">📂</div><p class="muted">Import a folder of photos first.</p></div>' : `
      ${missingFiles() ? `<div class="banner banner-warn">${icon('folder')}<div class="grow">HomeBase needs permission to see this match’s photo folder again.</div>${getHandle(id) ? '<button class="btn btn-sm" data-reconnect>Reconnect folder</button>' : `<a class="btn btn-sm" href="#/photo/import/${esc(id)}">Choose folder</a>`}</div>` : ''}
      <div class="cull-layout">
        <aside class="cull-groups">${groups().map(([gid, name, n]) => `<button class="${st.group === gid ? 'on' : ''}" data-group="${esc(gid)}"><span>${esc(name)}</span><b>${n}</b></button>`).join('')}</aside>
        <div>
          <div class="toolbar" style="flex-wrap:wrap;margin-bottom:10px">
            <div class="segmented" style="flex:1;min-width:260px">${[['all', 'All'], ['pick', 'Picks'], ['unflagged', 'Unflagged'], ['reject', 'Rejects']].map(([v, l]) => `<button data-flag="${v}" aria-pressed="${st.flag === v}">${l}</button>`).join('')}</div>
            <select data-min aria-label="Minimum rating">${[0, 1, 2, 3, 4, 5].map((r) => `<option value="${r}" ${st.minRating === r ? 'selected' : ''}>${r ? `${'★'.repeat(r)} or more` : 'Any rating'}</option>`).join('')}</select>
            ${numbers.length ? `<select data-number aria-label="Player"><option value="">Any player</option>${numbers.map((n) => `<option ${String(n) === st.number ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
          </div>
          <div class="cull-grid">${list.map((p, i) => `<button class="cull-tile ${p.flag ? 'f-' + p.flag : ''}" data-open="${i}"><img data-th="${esc(p.id)}" alt="" loading="lazy">
            <span class="ct-info">${p.rating ? `<span class="ct-stars">${'★'.repeat(p.rating)}</span>` : ''}${p.flag === 'pick' ? '<span class="ct-flag">P</span>' : p.flag === 'reject' ? '<span class="ct-flag x">X</span>' : ''}</span>
            <span class="ct-name">${esc(p.name)}</span></button>`).join('') || '<p class="muted">No photos match.</p>'}</div>
          <p class="small muted">Keyboard: ${KEYS}</p>
        </div></div>`}`;
    loadThumbs();
  };

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); setThumb(en.target); }
  }, { rootMargin: '400px' }) : null;
  const setThumb = async (img) => { const f = sessionFiles.get(img.dataset.th); if (f) { const u = await thumbUrl(img.dataset.th, f, 360); if (u) img.src = u; } };
  const loadThumbs = () => root.querySelectorAll('img[data-th]').forEach((img) => (io ? io.observe(img) : setThumb(img)));

  // ---------- viewer ----------
  let viewerEl = null;
  const openViewer = (i) => { st.viewer = i; st.focus = 0; drawViewer(); };
  const closeViewer = () => { st.viewer = null; st.compare = false; viewerEl?.remove(); viewerEl = null; saving.then(draw); };
  const burstMates = (p) => list.filter((x) => x.burst != null && x.burst === p.burst);

  async function drawViewer() {
    const p = list[st.viewer];
    if (!p) return closeViewer();
    if (!viewerEl) { viewerEl = document.createElement('div'); viewerEl.className = 'viewer'; document.body.appendChild(viewerEl); }
    const shown = st.compare ? [p, list[st.viewer + 1]].filter(Boolean) : [p];
    const mo = momentsOf(id).find((x) => x.id === p.momentId);
    viewerEl.innerHTML = `<div class="v-top"><b>${st.viewer + 1}/${list.length}</b><span>${esc(mo?.name || (p.cameraMs == null ? 'No time info' : 'Not near a moment'))}</span><span class="spacer"></span>
        <button class="btn btn-sm" data-v="compare">${st.compare ? 'Single' : 'Compare (C)'}</button><button class="btn btn-sm" data-v="close">Close (Esc)</button></div>
      <div class="v-stage ${shown.length > 1 ? 'two' : ''}">${shown.map((x, k) => `<figure class="${st.compare && k === st.focus ? 'focus' : ''}" data-fig="${k}"><img data-full="${esc(x.id)}" alt=""><figcaption>${esc(x.name)} · ${'★'.repeat(x.rating || 0)}${'☆'.repeat(5 - (x.rating || 0))} ${x.flag === 'pick' ? '· <b class="pk">PICK</b>' : x.flag === 'reject' ? '· <b class="rj">REJECT</b>' : ''}</figcaption></figure>`).join('')}</div>
      <div class="v-bar"><button class="btn" data-v="prev">←</button>${[1, 2, 3, 4, 5].map((r) => `<button class="btn" data-v="r${r}">${r}★</button>`).join('')}
        <button class="btn btn-ok" data-v="pick">Pick (P)</button><button class="btn btn-danger" data-v="reject">Reject (X)</button><button class="btn" data-v="next">→</button></div>`;
    for (const img of viewerEl.querySelectorAll('img[data-full]')) {
      const f = sessionFiles.get(img.dataset.full);
      if (f) fullUrl(img.dataset.full, f).then((u) => { if (u) img.src = u; });
    }
    // Pre-load the next one for speed.
    const nx = list[st.viewer + 1];
    if (nx && sessionFiles.get(nx.id)) fullUrl(nx.id, sessionFiles.get(nx.id));
    void burstMates;
  }

  let saving = Promise.resolve();
  async function act(a) {
    const target = list[st.viewer + (st.compare ? st.focus : 0)];
    if (!target) return;
    if (a === 'next') { st.viewer = Math.min(list.length - 1, st.viewer + 1); return drawViewer(); }
    if (a === 'prev') { st.viewer = Math.max(0, st.viewer - 1); return drawViewer(); }
    if (a === 'close') return closeViewer();
    if (a === 'compare') { st.compare = !st.compare; st.focus = 0; return drawViewer(); }
    let patch = null;
    if (/^r[0-5]$/.test(a)) patch = { rating: +a[1] === target.rating ? 0 : +a[1] };
    if (a === 'r0') patch = { rating: 0 };
    if (a === 'pick') patch = { flag: target.flag === 'pick' ? '' : 'pick' };
    if (a === 'reject') patch = { flag: target.flag === 'reject' ? '' : 'reject' };
    if (a === 'unflag') patch = { flag: '' };
    if (patch) {
      // Update the screen first and save in the background, so fast key presses
      // always apply to the photo you're looking at.
      list = list.map((x) => (x.id === target.id ? { ...x, ...patch } : x));
      saving = saving.then(() => store.patch('photos', target.id, patch));
      // Picking/rejecting moves on automatically (like Lightroom's auto-advance).
      if ((a === 'pick' || a === 'reject') && !st.compare && st.viewer < list.length - 1) st.viewer++;
      drawViewer();
    }
  }

  const onKey = (e) => {
    if (st.viewer == null || e.target.closest?.('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    const map = { arrowright: 'next', arrowleft: 'prev', escape: 'close', p: 'pick', x: 'reject', u: 'unflag', c: 'compare', 0: 'r0', 1: 'r1', 2: 'r2', 3: 'r3', 4: 'r4', 5: 'r5' };
    if (k === 'tab' && st.compare) { e.preventDefault(); st.focus = st.focus ? 0 : 1; drawViewer(); return; }
    if (map[k]) { e.preventDefault(); act(map[k]); }
  };
  document.addEventListener('keydown', onKey);
  const onViewerClick = (e) => {
    if (!viewerEl?.contains(e.target)) return;
    const b = e.target.closest('[data-v]');
    if (b) act(b.dataset.v);
    const fig = e.target.closest('[data-fig]');
    if (fig && st.compare) { st.focus = +fig.dataset.fig; drawViewer(); }
  };
  document.addEventListener('click', onViewerClick);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.group) { st.group = b.dataset.group; draw(); }
    else if (b.dataset.flag) { st.flag = b.dataset.flag; draw(); }
    else if (b.dataset.open) openViewer(+b.dataset.open);
    else if ('reconnect' in b.dataset) {
      const h = getHandle(id);
      if (await ensurePermission(h)) {
        const entries = await walk(h);
        for (const en of entries) sessionFiles.set(photoId(id, en.path), en.file);
        toast(`Reconnected ${plural(entries.length, 'photo')}`, { kind: 'ok' });
        draw();
      } else toast('Permission not given.', { kind: 'warn' });
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-min]')) { st.minRating = +e.target.value; draw(); }
    if (e.target.matches('[data-number]')) { st.number = e.target.value; draw(); }
  });
  draw();
  void m; void ctx; void KEYS;
  return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onViewerClick); viewerEl?.remove(); io?.disconnect(); };
}
