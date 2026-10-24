// ⛳ Golf on the computer: swing list, detail, compare, trends.
import * as store from '../../core/store.js';
import { esc, icon, confirmDialog, toast, formatDate, plural, promptDialog } from '../../core/ui.js';
import { lineChart, bars, tally, seriesColor } from '../../core/charts.js';
import { magnitude, CLUBS, RESULTS, averages, analyzeSwing, PLACEMENTS, groupSessions, tempoSpread } from './analysis.js';
import { golfers, golferName } from './golfers.js';
import { unpack } from './sensors.js';
import { metricsHtml, swingChart, ESTIMATE_NOTE } from './record.js';

export const swings = () => store.all('swings').sort((a, b) => b.t - a.t);
const resultLabel = (id) => RESULTS.find((r) => r.id === id) || null;
const when = (t) => `${formatDate(t)} ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

// Golfer filter shared by Swings and Trends ('all' | '' (Anyone) | golfer id), remembered on this device.
const getFilter = () => store.getLocal('golf.filter', 'all');
const byFilter = (list, f) => (f === 'all' ? list : list.filter((s) => (s.golferId || '') === f));
function filterChips(f) {
  const list = golfers();
  if (!list.length) return '';
  return `<div class="chips" style="margin-bottom:12px" role="group" aria-label="Golfer">${[['all', 'Everyone'], ['', 'Anyone (no profile)'], ...list.map((g) => [g.id, g.name])]
    .map(([v, l]) => `<button class="chip chip-sm" data-filter="${esc(v)}" aria-pressed="${f === v}">${esc(l)}</button>`).join('')}</div>`;
}
const sessionName = (sess) => store.get('golfSessions', sess.id)?.name || '';
const timeOnly = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const findSession = (id) => groupSessions(store.all('swings')).find((x) => x.id === id) || null;

function sessionSummary(sess) {
  const a = averages(sess.swings);
  const spread = tempoSpread(sess.swings);
  return [plural(sess.swings.length, 'swing'), a.tempo ? `tempo ${a.tempo.toFixed(1)}:1${spread != null ? ` ±${spread.toFixed(1)}` : ''}` : '', a.handSpeedMph ? `${Math.round(a.handSpeedMph)} mph hands` : ''].filter(Boolean).join(' · ');
}
const swingRow = (s) => `<a class="row" href="#/golf/swing/${esc(s.id)}"><span class="thumb-sq">${resultLabel(s.result)?.emoji || '⛳'}</span>
  <div class="grow"><div class="row-title">${esc(s.club)} · tempo ${s.metrics?.tempo ? s.metrics.tempo.toFixed(1) + ':1' : '–'}</div>
  <div class="row-sub">${esc(timeOnly(s.t))}${s.result ? ` · ${esc(resultLabel(s.result)?.label || '')}` : ''}${s.metrics ? ` · ${Math.round(s.metrics.handSpeedMph)} mph hands` : ''}</div></div></a>`;

export function renderSwings(root) {
  let limit = 15;
  const draw = () => {
    const f = getFilter();
    const all = swings();
    const sessions = groupSessions(byFilter(all, f));
    root.innerHTML = `<div class="page-head"><h1>My swings</h1><a class="btn btn-primary" href="#/golf">${icon('play')} Record</a><a class="btn" href="#/golf/compare">Compare</a><a class="btn" href="#/golf/golfers">${icon('users')} Golfers</a></div>
      ${filterChips(f)}
      ${sessions.length ? sessions.slice(0, limit).map((sess) => {
        const latest = sess.swings.slice().reverse();
        return `<section class="card session-card"><div class="session-head"><a href="#/golf/session/${esc(sess.id)}">${esc(sessionName(sess) || formatDate(sess.start))} · ${esc(timeOnly(sess.start))}${timeOnly(sess.end) !== timeOnly(sess.start) ? `–${esc(timeOnly(sess.end))}` : ''}</a>
          ${golfers().length ? `<span class="small"><b>${esc(golferName(sess.golferId))}</b></span>` : ''}<span class="small muted">${esc(sessionSummary(sess))}</span></div>
          <div class="rows">${latest.slice(0, 8).map(swingRow).join('')}</div>
          ${latest.length > 8 ? `<a class="btn btn-ghost btn-sm" href="#/golf/session/${esc(sess.id)}">All ${latest.length} swings in this session →</a>` : ''}</section>`;
      }).join('') + (sessions.length > limit ? `<button class="btn btn-block" data-more>Show older sessions (${sessions.length - limit} more)</button>` : '')
        : all.length ? '<div class="card muted">No swings for this golfer yet.</div>'
        : '<div class="empty"><div class="art">⛳</div><p class="muted">No swings yet. Record some on your phone — they appear here live.</p><a class="btn btn-primary" href="#/golf">Record a swing</a></div>'}`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.filter != null) { await store.setLocal('golf.filter', b.dataset.filter); draw(); }
    if ('more' in b.dataset) { limit += 15; draw(); }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'swings' || c.c === 'golfers' || c.c === 'golfSessions')) draw(); });
}

export function renderSession(root, [id]) {
  const draw = () => {
    const sess = findSession(id);
    if (!sess) { root.innerHTML = '<div class="empty"><h2>Session not found</h2><a class="btn" href="#/golf/swings">Back</a></div>'; return; }
    const meta = store.get('golfSessions', id) || {};
    const list = sess.swings;
    const a = averages(list);
    const spread = tempoSpread(list);
    const good = list.filter((s) => s.result === 'good').length;
    const tagged = list.filter((s) => s.result).length;
    const withTempo = list.filter((s) => s.metrics?.tempo);
    const clubs = CLUBS.map((c) => [c, averages(list.filter((s) => s.club === c))]).filter(([, x]) => x.count);
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/golf/swings" aria-label="Back">${icon('back')}</a><h1>${esc(meta.name || 'Practice session')}</h1><button class="btn" data-rename>${icon('edit')} Name</button></div>
      <p class="muted">${esc(formatDate(sess.start))}, ${esc(timeOnly(sess.start))}${timeOnly(sess.end) !== timeOnly(sess.start) ? `–${esc(timeOnly(sess.end))}` : ''}${golfers().length ? ` · ${esc(golferName(sess.golferId))}` : ''}</p>
      <div class="stat-grid">
        <div class="stat"><b>${list.length}</b><span>Swings</span></div>
        <div class="stat"><b>${a.tempo ? a.tempo.toFixed(1) + ':1' : '–'}</b><span>Average tempo</span></div>
        <div class="stat"><b>${spread != null ? '±' + spread.toFixed(2) : '–'}</b><span>Tempo consistency (lower is steadier)</span></div>
        <div class="stat"><b>${a.handSpeedMph ? Math.round(a.handSpeedMph) + ' mph' : '–'}</b><span>Hand speed (est.)</span></div>
        <div class="stat"><b>${tagged ? Math.round((good / tagged) * 100) + '%' : '–'}</b><span>Good shots (of ${tagged} tagged)</span></div>
      </div>
      ${withTempo.length > 1 ? `<div class="card section"><h2>Tempo through the session</h2>${lineChart([{ name: 'Tempo', points: withTempo.map((s, i) => [i + 1, s.metrics.tempo]) }, { name: 'Ideal 3:1', points: [[1, 3], [withTempo.length, 3]], color: 'var(--ok)', dashed: true }], { yMin: 0, height: 200, xFmt: (x) => `#${Math.round(x)}`, yFmt: (y) => y.toFixed(1) })}</div>` : ''}
      ${clubs.length > 1 ? `<div class="card section"><h2>By club</h2>${clubTable(clubs, 'Club')}</div>` : ''}
      <div class="card section"><h2>Notes</h2><textarea data-notes rows="3" aria-label="Session notes" placeholder="What were you working on?">${esc(meta.notes || '')}</textarea></div>
      <div class="section"><div class="section-title">Swings</div><div class="rows">${list.slice().reverse().map(swingRow).join('')}</div></div>`;
  };
  root.addEventListener('change', (e) => { if (e.target.matches('[data-notes]')) store.put('golfSessions', { ...(store.get('golfSessions', id) || {}), id, notes: e.target.value }); });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-rename]')) return;
    const name = await promptDialog({ title: 'Name this session', value: store.get('golfSessions', id)?.name || '', placeholder: 'e.g. Range — working on tempo' });
    if (name != null) store.put('golfSessions', { ...(store.get('golfSessions', id) || {}), id, name });
  });
  draw();
  return store.onChange(({ changes }) => {
    if (!changes.some((c) => c.c === 'swings' || c.c === 'golfers' || (c.c === 'golfSessions' && c.record.id === id))) return;
    // Don't redraw under someone typing their notes.
    if (document.activeElement?.matches?.('[data-notes]') && !changes.some((c) => c.c === 'swings')) return;
    draw();
  });
}

const clubTable = (rows, label) => `<div class="table-wrap"><table class="table"><thead><tr><th>${label}</th><th class="num">Swings</th><th class="num">Tempo</th><th class="num">Back</th><th class="num">Down</th><th class="num">Peak °/s</th><th class="num">Hands mph</th></tr></thead><tbody>
  ${rows.map(([n, a]) => `<tr><td>${esc(n)}</td><td class="num">${a.count}</td><td class="num"><b>${a.tempo.toFixed(1)}</b></td><td class="num">${(a.backswingMs / 1000).toFixed(2)}s</td><td class="num">${(a.downswingMs / 1000).toFixed(2)}s</td><td class="num">${Math.round(a.peakRotation)}</td><td class="num">${Math.round(a.handSpeedMph)}</td></tr>`).join('')}</tbody></table></div>`;

export function renderSwing(root, [id]) {
  const draw = () => {
    const s = store.get('swings', id);
    if (!s) { root.innerHTML = '<div class="empty"><h2>Swing not found</h2><a class="btn" href="#/golf/swings">Back</a></div>'; return; }
    const samples = unpack(s.samples);
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/golf/swings" aria-label="Back">${icon('back')}</a><h1>${esc(s.club)} swing</h1>
        <a class="btn" href="#/golf/compare/${esc(id)}">Compare…</a><button class="icon-btn" data-del aria-label="Delete">${icon('trash')}</button></div>
      <p class="muted">${esc(when(s.t))} · ${esc(PLACEMENTS.find((p) => p.id === s.placement)?.label || '')}${golfers().length ? ` · ${esc(golferName(s.golferId))}` : ''}${(() => { const sess = groupSessions(store.all('swings')).find((x) => x.swings.some((y) => y.id === s.id)); return sess ? ` · <a href="#/golf/session/${esc(sess.id)}">Practice session (${sess.swings.length} swings)</a>` : ''; })()}
        ${s.metrics?.impactFrom === 'accel' ? ' · impact timed from the ball strike' : ''}</p>
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
    const who = (s) => (golfers().length ? `${golferName(s.golferId)} · ` : '');
    const opt = (sel) => list.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(who(s))}${esc(s.club)} · ${esc(when(s.t))}${s.result ? ` · ${esc(resultLabel(s.result)?.label)}` : ''}</option>`).join('');
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
    const f = getFilter();
    const list = byFilter(swings(), f).filter((s) => s.metrics?.tempo).reverse();
    const sessions = groupSessions(list).filter((x) => x.swings.length >= 2).slice(0, 12);
    const byClub = CLUBS.map((c) => [c, averages(list.filter((s) => s.club === c))]).filter(([, a]) => a.count);
    const byResult = RESULTS.map((r) => [r, averages(list.filter((s) => s.result === r.id))]).filter(([, a]) => a.count);
    const tbl = clubTable;
    root.innerHTML = `<h1>Trends</h1>${filterChips(f)}
      ${!list.length ? '<div class="card muted">Record some swings to see trends.</div>' : `
      <div class="stat-grid">${(() => { const a = averages(list); return `<div class="stat"><b>${list.length}</b><span>Swings</span></div><div class="stat"><b>${a.tempo.toFixed(1)}:1</b><span>Average tempo</span></div><div class="stat"><b>${Math.round(a.handSpeedMph)} mph</b><span>Average hand speed (est.)</span></div><div class="stat"><b>${list.filter((s) => s.result === 'good').length}</b><span>Good shots</span></div>`; })()}</div>
      <div class="card section"><h2>Tempo over time</h2>${lineChart([{ name: 'Tempo', points: list.map((s, i) => [i + 1, s.metrics.tempo]) }, { name: 'Ideal 3:1', points: [[1, 3], [Math.max(2, list.length), 3]], color: 'var(--ok)', dashed: true }], { yMin: 0, xFmt: (x) => `#${Math.round(x)}`, yFmt: (y) => y.toFixed(1) })}</div>
      <div class="card section"><h2>Hand speed over time (est.)</h2>${lineChart([{ name: 'mph', points: list.map((s, i) => [i + 1, s.metrics.handSpeedMph]) }], { xFmt: (x) => `#${Math.round(x)}` })}</div>
      ${sessions.length ? `<div class="card section"><h2>Practice sessions</h2><div class="table-wrap"><table class="table"><thead><tr><th>Session</th>${golfers().length ? '<th>Golfer</th>' : ''}<th class="num">Swings</th><th class="num">Tempo</th><th class="num">Consistency</th><th class="num">Hands mph</th></tr></thead><tbody>
        ${sessions.map((x) => { const a = averages(x.swings); const sp = tempoSpread(x.swings); return `<tr><td><a href="#/golf/session/${esc(x.id)}">${esc(sessionName(x) || when(x.start))}</a></td>${golfers().length ? `<td>${esc(golferName(x.golferId))}</td>` : ''}<td class="num">${x.swings.length}</td><td class="num"><b>${a.tempo.toFixed(1)}</b></td><td class="num">${sp != null ? '±' + sp.toFixed(2) : '–'}</td><td class="num">${Math.round(a.handSpeedMph)}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}
      <div class="two-col section"><div class="card"><h2>Average by club</h2>${tbl(byClub, 'Club')}</div><div class="card"><h2>Average by result</h2>${tbl(byResult.map(([r, a]) => [`${r.emoji} ${r.label}`, a]), 'Result')}</div>
      <div class="card"><h2>Results</h2>${bars(tally(list.map((s) => resultLabel(s.result)?.label || 'Not tagged')))}</div></div>
      <p class="small muted">${esc(ESTIMATE_NOTE)} ${plural(list.length, 'swing')} analysed.</p>`}`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-filter]');
    if (b) { await store.setLocal('golf.filter', b.dataset.filter); draw(); }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'swings' || c.c === 'golfers' || c.c === 'golfSessions')) draw(); });
}
