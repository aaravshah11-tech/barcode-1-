// ⛳ Record swings on the phone.
import * as store from '../../core/store.js';
import { esc, icon, toast, keepAwake } from '../../core/ui.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { lineChart } from '../../core/charts.js';
import { analyzeSwing, isStill, swingFinished, syntheticSwing, magnitude, CLUBS, RESULTS, PLACEMENTS, settingsFor, currentSession, groupSessions, SESSION_GAP } from './analysis.js';
import { requestMotionPermission, listen, pack } from './sensors.js';

export const ESTIMATE_NOTE = 'These numbers are estimates from your phone’s motion sensors. They’re great for comparing your own swings, not for exact club-head speed.';

export function metricsHtml(r, { big = true } = {}) {
  if (!r) return '';
  return `<div class="golf-metrics ${big ? 'big' : ''}">
    <div class="gm-tempo"><b>${r.tempo ? r.tempo.toFixed(1) : '–'}<small> : 1</small></b><span>Tempo (back : down) · ideal ≈ 3 : 1</span></div>
    <div class="stat-grid">
      <div class="stat"><b>${(r.backswingMs / 1000).toFixed(2)}s</b><span>Backswing</span></div>
      <div class="stat"><b>${(r.downswingMs / 1000).toFixed(2)}s</b><span>Downswing</span></div>
      <div class="stat"><b>${Math.round(r.peakRotation)}°/s</b><span>Peak rotation (est.)</span></div>
      <div class="stat"><b>${Math.round(r.handSpeedMph)} mph</b><span>Hand speed (rough est.)</span></div>
    </div>
    ${r.quality !== 'good' ? `<div class="banner banner-warn">${icon('info')}<div class="grow">This one looks unusual — check the graph. Hold still before you start and finish your swing fully.</div></div>` : ''}</div>`;
}

export function swingChart(samples, r, { height = 200 } = {}) {
  if (!samples.length) return '';
  const t0 = samples[r?.start ?? 0].t;
  const x = (s) => (s.t - t0) / 1000;
  const mags = samples.map((s) => [x(s), magnitude(s)]);
  const series = [{ name: 'Rotation speed (°/s)', points: mags, color: 'var(--tool)' }];
  if (r?.axis) series.push({ name: 'Main axis (− back, + down)', points: samples.map((s) => [x(s), s[r.axis] * Math.sign(samples[r.impact][r.axis] || 1)]), color: 'var(--c2)', dashed: true });
  const markers = r ? [['Start', r.start], ['Top', r.top], ['Impact', r.impact], ['Finish', r.finish]].map(([label, i]) => ({ x: x(samples[i]), label })) : [];
  return lineChart(series, { height, markers, xFmt: (v) => `${v.toFixed(1)}s` });
}

export function renderRecord(root, _p, ctx) {
  const prefs = { club: '7 iron', placement: 'glove', golferId: '', ...store.getLocal('golf.prefs', {}) };
  let state = 'idle'; // idle | arming | ready | result | nosensor | denied
  let buf = [];
  let stop = null;
  let result = null, samples = [];
  let release = null;
  const savePrefs = () => store.setLocal('golf.prefs', prefs);
  const golfer = () => (prefs.golferId ? store.get('golfers', prefs.golferId) : null);
  const settings = () => settingsFor(golfer(), prefs.placement);
  const sessionInfo = () => {
    if (store.getLocal('golf.newSession')) return null;
    const latest = groupSessions(store.all('swings').filter((x) => (x.golferId || '') === (prefs.golferId || '')))[0];
    return latest && Date.now() - latest.end <= SESSION_GAP ? { id: latest.id, count: latest.swings.length } : null;
  };

  const draw = () => {
    const status = {
      idle: ['', 'Choose your club, put the phone on your glove or forearm, then tap Ready.'],
      arming: ['warn', 'Hold still at address…'],
      ready: ['ok', 'Ready — swing when you like.'],
      nosensor: ['warn', 'No motion sensors found on this device. Open HomeBase on your phone — or try the demo swing.'],
      denied: ['danger', 'Motion access was blocked. On iPhone: close the app fully, open it again and tap Allow when asked (Settings › Safari › Motion & Orientation Access must be on).'],
    }[state];
    root.innerHTML = `<div class="live golf">
      ${state === 'result' ? `
        <h1>Swing</h1>
        ${result ? metricsHtml(result) : '<div class="banner banner-warn">No clear swing found in that movement.</div>'}
        ${result ? `<div class="card">${swingChart(samples, result, { height: 180 })}</div>` : ''}
        <p class="small muted">${esc(ESTIMATE_NOTE)}</p>
        ${result ? `<div class="section-title">How did it go?</div><div class="pad">${RESULTS.map((r) => `<button class="pad-btn" data-result="${r.id}"><span style="font-size:1.4rem">${r.emoji}</span>${r.label}</button>`).join('')}</div>` : ''}
        <div class="btn-row" style="margin-top:12px">${result ? '<button class="btn" data-save-plain>Save without a result</button>' : ''}<button class="btn btn-ghost" data-discard>Discard</button></div>`
      : `
        <div class="golf-status ${status[0]}"><div class="gs-dot"></div><b>${esc(status[1])}</b></div>
        ${golferRow()}
        <div class="picker-row"><span class="field-label">Club</span><div class="chips">${CLUBS.map((c) => `<button class="chip chip-sm" data-club="${esc(c)}" aria-pressed="${c === prefs.club}">${esc(c)}</button>`).join('')}</div></div>
        <div class="picker-row"><span class="field-label">Phone position</span><div class="segmented">${PLACEMENTS.map((p) => `<button data-place="${p.id}" aria-pressed="${p.id === prefs.placement}">${esc(p.label)}</button>`).join('')}</div></div>
        ${state === 'idle' || state === 'nosensor' || state === 'denied' ? `<button class="btn btn-primary btn-lg btn-block golf-ready" data-ready>${icon('play')} Ready</button>` : `<button class="btn btn-lg btn-block" data-cancel>Stop</button>`}
        ${state === 'ready' || state === 'arming' ? `<div class="golf-live"><span>Live rotation</span><b data-live>0</b><small>°/s</small></div>` : ''}
        ${sessionRow()}
        <button class="btn btn-ghost btn-block" data-demo style="margin-top:10px">Try a demo swing</button>
        <p class="small muted">${esc(ESTIMATE_NOTE)}</p>`}
      <div class="live-links"><a class="btn btn-ghost" href="#/golf/swings">${icon('list')} My swings</a><a class="btn btn-ghost" href="#/golf/trends">${icon('chart')} Trends</a></div>
    </div>`;
  };

  function golferRow() {
    const list = store.all('golfers').sort((a, b) => a.name.localeCompare(b.name));
    const g = golfer();
    return `<div class="picker-row"><span class="field-label">Who’s swinging</span><div class="chips">
      <button class="chip chip-sm" data-golfer="" aria-pressed="${!g}">Anyone</button>
      ${list.map((x) => `<button class="chip chip-sm" data-golfer="${esc(x.id)}" aria-pressed="${g?.id === x.id}">${esc(x.name)}${x.calibration ? '' : ' <span class="muted">·</span>'}</button>`).join('')}
      <a class="chip chip-sm" href="#/golf/golfers">${list.length ? 'Edit' : '+ Add golfer'}</a></div>
      ${g && !g.calibration ? `<p class="small" style="margin:6px 0 0"><a href="#/golf/calibrate/${esc(g.id)}">Calibrate for ${esc(g.name)}</a> — a minute of practice swings makes detection fit their swing.</p>` : ''}</div>`;
  }
  function sessionRow() {
    const s = sessionInfo();
    return `<div class="session-row small muted">${s ? `Practice session: <b>${s.count}</b> swing${s.count === 1 ? '' : 's'} so far · <button class="link-btn" data-new-session>Start a new session</button>` : 'Your next swing starts a new practice session.'}</div>`;
  }

  function finishCapture() {
    stop?.(); stop = null;
    // Keep from a bit before the swing started to the end.
    samples = buf.slice();
    result = analyzeSwing(samples, settings());
    state = 'result';
    feedback(result ? 'ok' : 'err');
    draw();
  }

  async function arm() {
    unlockAudio();
    const perm = await requestMotionPermission();
    if (perm !== 'granted') { state = perm === 'unsupported' ? 'nosensor' : 'denied'; return draw(); }
    buf = [];
    state = 'arming';
    draw();
    let readyAt = 0;
    stop = listen((s) => {
      buf.push(s);
      if (buf.length > 900) buf.splice(0, buf.length - 900); // ~8–15 s
      const live = root.querySelector('[data-live]');
      if (live) live.textContent = Math.round(magnitude(s));
      if (state === 'arming' && isStill(buf, 500, settings().stillThreshold)) {
        state = 'ready'; readyAt = s.t; feedback('ok'); draw();
        buf = buf.filter((x) => x.t >= s.t - 300); // forget the setup wobble
      } else if (state === 'ready' && s.t - readyAt > 300 && swingFinished(buf, { minPeak: settings().minPeak })) finishCapture();
    }, () => { if (state === 'arming' && !buf.length) { stop?.(); stop = null; state = 'nosensor'; draw(); } });
  }

  async function save(resultId) {
    const now = Date.now();
    const sessionId = (!store.getLocal('golf.newSession') && currentSession(store.all('swings'), prefs.golferId, now)) || store.uid();
    if (store.getLocal('golf.newSession')) await store.setLocal('golf.newSession', false);
    const rec = await store.put('swings', { club: prefs.club, placement: prefs.placement, result: resultId || '', t: now, samples: pack(samples), metrics: result, golferId: prefs.golferId || '', sessionId });
    toast(`Saved ${prefs.club} swing${resultId ? ` (${RESULTS.find((r) => r.id === resultId).label})` : ''}`, { kind: 'ok', actionLabel: 'View', onAction: () => { location.hash = `#/golf/swing/${rec.id}`; } });
    result = null; samples = [];
    arm(); // straight back to ready for the next ball
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.club) { prefs.club = d.club; savePrefs(); draw(); }
    else if (d.place) { prefs.placement = d.place; savePrefs(); draw(); }
    else if (d.golfer != null) { prefs.golferId = d.golfer; const g = golfer(); if (g?.placement) prefs.placement = g.placement; savePrefs(); draw(); }
    else if ('newSession' in d) { await store.setLocal('golf.newSession', true); toast('Your next swing starts a new practice session'); draw(); }
    else if ('ready' in d) arm();
    else if ('cancel' in d) { stop?.(); stop = null; state = 'idle'; draw(); }
    else if ('demo' in d) { stop?.(); stop = null; buf = syntheticSwing({ backMs: 780 + Math.random() * 200, downMs: 260 + Math.random() * 60, peak: 1300 + Math.random() * 400, noise: 10 }); finishCapture(); }
    else if (d.result) save(d.result);
    else if ('savePlain' in d) save('');
    else if ('discard' in d) { result = null; state = 'idle'; draw(); }
  });
  ctx.hideNav?.(false);
  keepAwake().then((r) => { release = r; });
  draw();
  return () => { stop?.(); release?.(); };
}
