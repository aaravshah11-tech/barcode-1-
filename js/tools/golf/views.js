// ⛳ Golf on the computer: swing list, detail, compare, trends.
import * as store from '../../core/store.js';
import { esc, icon, confirmDialog, toast, formatDate, plural } from '../../core/ui.js';
import { lineChart, bars, tally, seriesColor } from '../../core/charts.js';
import { magnitude, CLUBS, RESULTS, averages, analyzeSwing, PLACEMENTS } from './analysis.js';
import { unpack } from './sensors.js';
import { metricsHtml, swingChart, ESTIMATE_NOTE } from './record.js';

export const swings = () => store.all('swings').sort((a, b) => b.t - a.t);
const resultLabel = (id) => RESULTS.find((r) => r.id === id) || null;
const when = (t) => `${formatDate(t)} ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

export function renderSwings(root) {
  const draw = () => {
    const list = swings();
    root.innerHTML = `<div class="page-head"><h1>My swings</h1><a class="btn btn-primary" href="#/golf">${icon('play')} Record</a><a class="btn" href="#/golf/compare">Compare</a></div>
      ${list.length ? `<div class="rows">${list.map((s) => `<a class="row" href="#/golf/swing/${esc(s.id)}"><span class="thumb-sq">${resultLabel(s.result)?.emoji || '⛳'}</span>
        <div class="grow"><div class="row-title">${esc(s.club)} · tempo ${s.metrics?.tempo ? s.metrics.tempo.toFixed(1) + ':1' : '–'}</div>
        <div class="row-sub">${esc(when(s.t))}${s.result ? ` · ${esc(resultLabel(s.result)?.label || '')}` : ''} · ${s.metrics ? Math.round(s.metrics.handSpeedMph) + ' mph hands' : ''}</div></div></a>`).join('')}</div>`
        : '<div class="empty"><div class="art">⛳</div><p class="muted">No swings yet. Record some on your phone — they appear here live.</p><a class="btn btn-primary" href="#/golf">Record a swing</a></div>'}`;
  };
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'swings')) draw(); });
}

export function renderSwing(root, [id]) {
  const draw = () => {
    const s = store.get('swings', id);
    if (!s) { root.innerHTML = '<div class="empty"><h2>Swing not found</h2><a class="btn" href="#/golf/swings">Back</a></div>'; return; }
    const samples = unpack(s.samples);
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/golf/swings" aria-label="Back">${icon('back')}</a><h1>${esc(s.club)} swing</h1>
        <a class="btn" href="#/golf/compare/${esc(id)}">Compare…</a><button class="icon-btn" data-del aria-label="Delete">${icon('trash')}</button></div>
      <p class="muted">${esc(when(s.t))} · ${esc(PLACEMENTS.find((p) => p.id === s.placement)?.label || '')}</p>
      ${metricsHtml(s.metrics)}
      <div class="card section"><h2>Motion</h2>${swingChart(samples, s.metrics, { height: 260 })}</div>
      <div class="two-col section">
        <div class="card"><h2>Club</h2><select data-club>${CLUBS.map((c) => `<option ${c === s.club ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="card"><h2>Result</h2><div class="chips">${RESULTS.map((r) => `<button class="chip chip-sm" data-result="${r.id}" aria-pressed="${r.id === s.result}">${r.emoji} ${r.label}</button>`).join('')}</div></div>
      </div>
      <p class="small muted">${esc(ESTIMATE_NOTE)}</p>`;
  };
  root.addEventListener('change', (e) => { if (e.target.matches('[data-club]')) store.patch('swings', id, { club: e.target.value }); });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.result) store.patch('swings', id, { result: store.get('swings', id).result === b.dataset.result ? '' : b.dataset.result });
    if ('del' in b.dataset && await confirmDialog({ title: 'Delete this swing?', confirmLabel: 'Delete', danger: true })) {
      const prev = await store.remove('swings', id);
      location.hash = '#/golf/swings';
      toast('Swing deleted', { actionLabel: 'Undo', onAction: () => store.restore('swings', prev) });
    }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'swings' && c.record.id === id)) draw(); });
}

export function renderCompare(root, [aId, bId]) {
  const list = swings();
  let A = aId || list[0]?.id, B = bId || list.find((s) => s.id !== A)?.id;
  const draw = () => {
    const a = store.get('swings', A), b = store.get('swings', B);
    const opt = (sel) => list.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.club)} · ${esc(when(s.t))}${s.result ? ` · ${esc(resultLabel(s.result)?.label)}` : ''}</option>`).join('');
    const aligned = (s, i) => {
      const smp = unpack(s.samples);
      const imp = s.metrics ? smp[s.metrics.impact].t : smp.at(-1)?.t || 0;
      return { name: `${i ? 'B' : 'A'}: ${s.club}`, points: smp.map((x) => [(x.t - imp) / 1000, magnitude(x)]), color: seriesColor(i) };
    };
    const row = (label, f, fmt) => `<tr><td>${label}</td><td class="num">${a?.metrics ? fmt(f(a.metrics)) : '–'}</td><td class="num">${b?.metrics ? fmt(f(b.metrics)) : '–'}</td></tr>`;
    root.innerHTML = `<h1>Compare swings</h1>
      ${list.length < 2 ? '<div class="card muted">Record at least two swings to compare them.</div>' : `
      <div class="field-row"><label class="field"><span>Swing A</span><select data-a>${opt(A)}</select></label><label class="field"><span>Swing B</span><select data-b>${opt(B)}</select></label></div>
      <div class="card"><h2>Rotation speed, lined up at impact</h2>${a && b ? lineChart([aligned(a, 0), aligned(b, 1)], { height: 260, xFmt: (v) => `${v.toFixed(1)}s`, markers: [{ x: 0, label: 'Impact' }] }) : ''}</div>
      <div class="card section"><table class="table"><thead><tr><th></th><th class="num">A</th><th class="num">B</th></tr></thead><tbody>
        ${row('Tempo', (m) => m.tempo, (v) => (v ? `${v.toFixed(1)} : 1` : '–'))}${row('Backswing', (m) => m.backswingMs, (v) => `${(v / 1000).toFixed(2)} s`)}
        ${row('Downswing', (m) => m.downswingMs, (v) => `${(v / 1000).toFixed(2)} s`)}${row('Peak rotation', (m) => m.peakRotation, (v) => `${Math.round(v)} °/s`)}
        ${row('Hand speed (est.)', (m) => m.handSpeedMph, (v) => `${Math.round(v)} mph`)}
        <tr><td>Result</td><td class="num">${esc(resultLabel(a?.result)?.label || '–')}</td><td class="num">${esc(resultLabel(b?.result)?.label || '–')}</td></tr></tbody></table></div>`}`;
  };
  root.addEventListener('change', (e) => { if (e.target.matches('[data-a]')) A = e.target.value; if (e.target.matches('[data-b]')) B = e.target.value; draw(); });
  draw();
  void analyzeSwing;
}

export function renderTrends(root) {
  const draw = () => {
    const list = swings().filter((s) => s.metrics?.tempo).reverse();
    const byClub = CLUBS.map((c) => [c, averages(list.filter((s) => s.club === c))]).filter(([, a]) => a.count);
    const byResult = RESULTS.map((r) => [r, averages(list.filter((s) => s.result === r.id))]).filter(([, a]) => a.count);
    const tbl = (rows, label) => `<div class="table-wrap"><table class="table"><thead><tr><th>${label}</th><th class="num">Swings</th><th class="num">Tempo</th><th class="num">Back</th><th class="num">Down</th><th class="num">Peak °/s</th><th class="num">Hands mph</th></tr></thead><tbody>
      ${rows.map(([n, a]) => `<tr><td>${esc(n)}</td><td class="num">${a.count}</td><td class="num"><b>${a.tempo.toFixed(1)}</b></td><td class="num">${(a.backswingMs / 1000).toFixed(2)}s</td><td class="num">${(a.downswingMs / 1000).toFixed(2)}s</td><td class="num">${Math.round(a.peakRotation)}</td><td class="num">${Math.round(a.handSpeedMph)}</td></tr>`).join('')}</tbody></table></div>`;
    root.innerHTML = `<h1>Trends</h1>
      ${!list.length ? '<div class="card muted">Record some swings to see trends.</div>' : `
      <div class="stat-grid">${(() => { const a = averages(list); return `<div class="stat"><b>${list.length}</b><span>Swings</span></div><div class="stat"><b>${a.tempo.toFixed(1)}:1</b><span>Average tempo</span></div><div class="stat"><b>${Math.round(a.handSpeedMph)} mph</b><span>Average hand speed (est.)</span></div><div class="stat"><b>${list.filter((s) => s.result === 'good').length}</b><span>Good shots</span></div>`; })()}</div>
      <div class="card section"><h2>Tempo over time</h2>${lineChart([{ name: 'Tempo', points: list.map((s, i) => [i + 1, s.metrics.tempo]) }, { name: 'Ideal 3:1', points: [[1, 3], [Math.max(2, list.length), 3]], color: 'var(--ok)', dashed: true }], { yMin: 0, xFmt: (x) => `#${Math.round(x)}`, yFmt: (y) => y.toFixed(1) })}</div>
      <div class="card section"><h2>Hand speed over time (est.)</h2>${lineChart([{ name: 'mph', points: list.map((s, i) => [i + 1, s.metrics.handSpeedMph]) }], { xFmt: (x) => `#${Math.round(x)}` })}</div>
      <div class="two-col section"><div class="card"><h2>Average by club</h2>${tbl(byClub, 'Club')}</div><div class="card"><h2>Average by result</h2>${tbl(byResult.map(([r, a]) => [`${r.emoji} ${r.label}`, a]), 'Result')}</div>
      <div class="card"><h2>Results</h2>${bars(tally(list.map((s) => resultLabel(s.result)?.label || 'Not tagged')))}</div></div>
      <p class="small muted">${esc(ESTIMATE_NOTE)} ${plural(list.length, 'swing')} analysed.</p>`}`;
  };
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'swings')) draw(); });
}
