// ⛳ Golfer profiles and quick per-person calibration.
import * as store from '../../core/store.js';
import { esc, icon, toast, confirmDialog, openSheet, keepAwake, formatDate } from '../../core/ui.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { analyzeSwing, isStill, swingFinished, syntheticSwing, magnitude, calibrate, radiusFor, PLACEMENTS } from './analysis.js';
import { requestMotionPermission, listen } from './sensors.js';

export const golfers = () => store.all('golfers').sort((a, b) => a.name.localeCompare(b.name));
export const golferName = (id) => (id ? store.get('golfers', id)?.name || 'Removed golfer' : 'Anyone');
const SWINGS_NEEDED = 3;

function editGolfer(g = null) {
  const s = openSheet(`<form>
      <label class="field"><span>Name</span><input name="name" value="${esc(g?.name || '')}" required autocomplete="off"></label>
      <label class="field"><span>Height (cm) — used to estimate hand speed</span><input name="height" type="number" inputmode="numeric" min="90" max="230" value="${esc(g?.heightCm || '')}" placeholder="e.g. 175"></label>
      <label class="field"><span>Usual phone position</span><select name="placement">${PLACEMENTS.map((p) => `<option value="${p.id}" ${(g?.placement || 'glove') === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      <div class="btn-row"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">${g ? 'Save' : 'Add golfer'}</button></div>
    </form>`, { title: g ? `Edit ${g.name}` : 'Add a golfer', dialog: true });
  const f = s.body.querySelector('form');
  setTimeout(() => f.name.focus(), 50);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return;
    const heightCm = +f.height.value || null;
    const rec = await store.put('golfers', { ...(g || {}), name, heightCm, placement: f.placement.value });
    s.close();
    toast(g ? 'Saved' : `Added ${name}`, { kind: 'ok' });
    if (!g) location.hash = `#/golf/golfers/${rec.id}`;
  };
}

export function renderGolfers(root, [focus]) {
  const draw = () => {
    const list = golfers();
    const counts = {};
    for (const s of store.all('swings')) counts[s.golferId || ''] = (counts[s.golferId || ''] || 0) + 1;
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/golf" aria-label="Back">${icon('back')}</a><h1>Golfers</h1><button class="btn btn-primary" data-add>${icon('plus')} Add golfer</button></div>
      <p class="muted">Give each person a profile so their swings, sessions and trends stay separate. Calibrating takes about a minute on the phone and tunes swing detection and hand speed to them.</p>
      ${list.length ? `<div class="rows">${list.map((g) => {
        const c = g.calibration;
        return `<div class="row ${g.id === focus ? 'hl' : ''}"><span class="thumb-sq">🏌️</span><div class="grow">
          <div class="row-title">${esc(g.name)}</div>
          <div class="row-sub">${g.heightCm ? `${g.heightCm} cm · arm ≈ ${radiusFor(g.heightCm, g.placement)} m` : 'No height set'} · ${counts[g.id] || 0} swings ·
            ${c ? `calibrated ${esc(formatDate(c.at))} (swings over ${c.minPeak}°/s count${c.avgTempo ? `, practice tempo ${c.avgTempo.toFixed(1)}:1` : ''})` : '<b>not calibrated</b>'}</div></div>
          <a class="btn btn-sm ${c ? '' : 'btn-primary'}" href="#/golf/calibrate/${esc(g.id)}">${c ? 'Recalibrate' : 'Calibrate'}</a>
          <button class="icon-btn" data-edit="${esc(g.id)}" aria-label="Edit ${esc(g.name)}">${icon('edit')}</button>
          <button class="icon-btn" data-del="${esc(g.id)}" aria-label="Remove ${esc(g.name)}">${icon('trash')}</button></div>`;
      }).join('')}</div>` : '<div class="empty"><div class="art">🏌️</div><p class="muted">No golfers yet. Swings recorded as “Anyone” still work fine.</p></div>'}`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('add' in b.dataset) editGolfer();
    if (b.dataset.edit) editGolfer(store.get('golfers', b.dataset.edit));
    if (b.dataset.del) {
      const g = store.get('golfers', b.dataset.del);
      if (!(await confirmDialog({ title: `Remove ${g.name}?`, message: 'Their swings are kept.', confirmLabel: 'Remove', danger: true }))) return;
      const prev = await store.remove('golfers', g.id);
      toast(`${g.name} removed`, { actionLabel: 'Undo', onAction: () => store.restore('golfers', prev) });
    }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'golfers')) draw(); });
}

export function renderCalibrate(root, [id], ctx) {
  let state = 'intro'; // intro | still | swing | done | nosensor | denied
  let still = [], captured = [], buf = [], stop = null, sub = 'arming', readyAt = 0, t0 = null, note = '', stillTh = 20, release = null, result = null;
  const g = () => store.get('golfers', id);

  const draw = () => {
    const gg = g();
    if (!gg) { root.innerHTML = '<div class="empty"><h2>Golfer not found</h2><a class="btn" href="#/golf/golfers">Back</a></div>'; return; }
    const dots = `<div class="calib-steps" aria-label="${captured.length} of ${SWINGS_NEEDED} practice swings">${Array.from({ length: SWINGS_NEEDED }, (_, i) => `<span class="${i < captured.length ? 'done' : ''}"></span>`).join('')}</div>`;
    const body = {
      intro: `<p>Takes about a minute. Put the phone where you’ll wear it (${esc(PLACEMENTS.find((p) => p.id === (gg.placement || 'glove'))?.label.toLowerCase())}), then:</p>
        <ol><li>Hold still at address for 3 seconds.</li><li>Make ${SWINGS_NEEDED} normal practice swings, pausing at address before each.</li></ol>
        <button class="btn btn-primary btn-lg btn-block" data-start>${icon('play')} Start calibrating</button>
        <button class="btn btn-ghost btn-block" data-demo>Try with a demo</button>`,
      still: `<div class="golf-status warn"><div class="gs-dot"></div><b>Hold still at address…</b></div><div class="calib-big" data-count>3</div>`,
      swing: `<div class="golf-status ${sub === 'ready' ? 'ok' : 'warn'}"><div class="gs-dot"></div><b>${sub === 'ready' ? `Practice swing ${captured.length + 1} of ${SWINGS_NEEDED} — swing when ready` : 'Hold still at address…'}</b></div>
        ${dots}${note ? `<p class="banner banner-warn">${esc(note)}</p>` : ''}<button class="btn btn-block" data-cancel>Stop</button>`,
      done: result ? `${dots}<div class="card"><h2>Done — tuned for ${esc(gg.name)}</h2><ul>
          <li>Swings faster than <b>${result.minPeak}°/s</b> are detected${result.avgPeak ? ` (your practice swings peaked around ${result.avgPeak}°/s)` : ''}.</li>
          <li>Hand speed uses an arm of about <b>${radiusFor(gg.heightCm, gg.placement)} m</b>${gg.heightCm ? '' : ' (add a height for a better estimate)'}.</li>
          ${result.avgTempo ? `<li>Practice tempo: <b>${result.avgTempo.toFixed(1)} : 1</b>.</li>` : ''}</ul></div>
        <button class="btn btn-primary btn-lg btn-block" data-go>${icon('play')} Record ${esc(gg.name)}’s swings</button>
        <button class="btn btn-ghost btn-block" data-start>Redo calibration</button>` : '',
      nosensor: `<div class="banner banner-warn">No motion sensors found on this device. Open this page on the phone — or try the demo.</div><button class="btn btn-block" data-demo>Try with a demo</button>`,
      denied: '<div class="banner banner-danger">Motion access was blocked. Close the app, open it again and tap Allow.</div><button class="btn btn-block" data-start>Try again</button>',
    }[state];
    root.innerHTML = `<div class="live golf"><div class="page-head"><a class="icon-btn" href="#/golf/golfers" aria-label="Back">${icon('back')}</a><h1>Calibrate ${esc(gg.name)}</h1></div>${body}</div>`;
  };

  const finish = async () => {
    stop?.(); stop = null;
    result = calibrate({ still, swings: captured });
    await store.patch('golfers', id, { calibration: { ...result, at: Date.now() } });
    state = 'done';
    feedback('ok');
    draw();
  };

  async function start() {
    unlockAudio();
    const perm = await requestMotionPermission();
    if (perm !== 'granted') { state = perm === 'unsupported' ? 'nosensor' : 'denied'; return draw(); }
    still = []; captured = []; buf = []; t0 = null; note = ''; result = null;
    state = 'still';
    draw();
    stop = listen((s) => {
      if (state === 'still') {
        if (t0 == null) t0 = s.t;
        if (s.t - t0 > 500) still.push(s);
        const left = Math.ceil((3500 - (s.t - t0)) / 1000);
        const el = root.querySelector('[data-count]');
        if (el && el.textContent !== String(left)) el.textContent = String(Math.max(0, left));
        if (s.t - t0 >= 3500) {
          const mags = still.map(magnitude).sort((a, b) => a - b);
          stillTh = Math.max(15, (mags[Math.floor(mags.length * 0.95)] || 0) * 2 + 8);
          // They're already holding still at address, so the first practice swing is armed straight away.
          state = 'swing'; sub = 'ready'; readyAt = s.t; buf = still.filter((x) => x.t >= s.t - 300); feedback('ok'); draw();
        }
        return;
      }
      if (state !== 'swing') return;
      buf.push(s);
      if (buf.length > 900) buf.splice(0, buf.length - 900);
      if (sub === 'arming' && isStill(buf, 500, stillTh)) {
        sub = 'ready'; readyAt = s.t; buf = buf.filter((x) => x.t >= s.t - 300); feedback('ok'); draw();
      } else if (sub === 'ready' && s.t - readyAt > 300 && swingFinished(buf, { minPeak: 180, threshold: Math.max(45, stillTh * 2) })) {
        const swing = buf.slice();
        buf = []; sub = 'arming';
        if (analyzeSwing(swing, { minPeak: 150 })) { captured.push(swing); note = ''; feedback('ok'); } else { note = 'Didn’t catch that one — pause at address, then swing again.'; feedback('err'); }
        if (captured.length >= SWINGS_NEEDED) finish(); else draw();
      }
    }, () => { if (state === 'still' && t0 == null) { stop?.(); stop = null; state = 'nosensor'; draw(); } });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('start' in b.dataset) start();
    if ('cancel' in b.dataset) { stop?.(); stop = null; state = 'intro'; draw(); }
    if ('demo' in b.dataset) {
      stop?.(); stop = null;
      still = syntheticSwing({ noise: 10 }).slice(0, 40);
      captured = [0, 1, 2].map(() => syntheticSwing({ peak: 1150 + Math.random() * 300, backMs: 800 + Math.random() * 150, noise: 8 }));
      finish();
    }
    if ('go' in b.dataset) {
      store.setLocal('golf.prefs', { ...store.getLocal('golf.prefs', {}), golferId: id, placement: g()?.placement || 'glove' });
      location.hash = '#/golf';
    }
  });
  ctx?.hideNav?.(false);
  keepAwake().then((r) => { release = r; });
  draw();
  return () => { stop?.(); release?.(); };
}
