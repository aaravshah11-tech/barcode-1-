// PERIMETER WATCH: looks outside through a window and recognises people, vehicles and animals — on this
// device only. Privacy-masked squares (neighbours, the road) are blacked out before anything looks at the
// picture, and the mission can't be armed until the masks are confirmed in the setup wizard.
// HQ only ever receives a line of text and numbers, e.g. "Person detected (front / driveway)".
import { openCamera } from '../lib/camera.js';
import { makeDetector } from '../lib/motion-core.js';
import { frameStats, makeCoverWatch } from '../lib/tamper-core.js';
import { COLS, ROWS, maskFrame, maskRects, pickDetection, describe, makeSpeedGuard, WATCH_LABEL } from '../lib/perimeter-core.js';
import { loadDetector } from '../lib/detector.js';
import { esc } from '../../shared/ui.js';

const DW = 320, DH = 240; // the small picture the recogniser looks at (masked first)

export async function start(ctx) {
  let s = ctx.settings;
  const root = ctx.root;
  let cam;
  try { cam = await openCamera(s.camera); } catch (e) {
    root.innerHTML = `<p class="c-red mono small">${esc(e.message)}</p>`;
    ctx.status({ state: 'camera blocked' });
    return { stop() {} };
  }
  const work = document.createElement('canvas');
  work.width = DW; work.height = DH;
  const wg = work.getContext('2d', { willReadFrequently: true });
  let stopped = false, timer = null, recogniser = null, recogniserState = 'loading';
  const speed = makeSpeedGuard();
  loadDetector().then((d) => { recogniser = d; recogniserState = 'ready'; }, (e) => { recogniserState = `motion only (${e.message})`; });

  /** The camera picture with the masked squares painted black — the only thing the recogniser ever sees. */
  function maskedPicture(mask) {
    if (cam.video.readyState < 2) return null;
    wg.drawImage(cam.video, 0, 0, DW, DH);
    wg.fillStyle = '#000';
    for (const [x, y, w, h] of maskRects(mask, DW, DH)) wg.fillRect(x, y, w, h);
    return work;
  }
  const gridHtml = (mask, ignore, editable) => Array.from({ length: COLS * ROWS }, (_, i) =>
    `<button type="button" data-cell="${i}" class="${mask.includes(i) ? 'masked' : ignore.includes(i) ? 'ignored' : ''}" aria-pressed="${mask.includes(i) || ignore.includes(i)}" aria-label="Square ${i + 1}" tabindex="${editable ? 0 : -1}"></button>`).join('');
  const camBox = (extra = '') => `<div class="cam-wrap"><div class="zone-grid mask-grid ${extra}" data-grid style="grid-template-columns:repeat(${COLS},1fr);grid-template-rows:repeat(${ROWS},1fr)"></div><div class="det-box" data-box hidden></div></div>`;
  // (a video taken out of the page pauses, so start it again each time it is put back)
  const attachVideo = () => { const w = root.querySelector('.cam-wrap'); if (w) w.prepend(cam.video); cam.video.play().catch(() => {}); };

  // ================= the setup wizard =================
  function wizard() {
    ctx.keepBright(true);
    ctx.status({ state: 'setting up — not armed' });
    const draft = { watch: s.watch, mask: [...s.mask], ignore: [...s.ignore], agreed: false, seen: [] };
    let step = 0, walkTimer = null;
    const STEPS = ['Window', 'Mount', 'Area', 'Privacy masks', 'Walk test', 'Arm'];
    const show = () => {
      clearInterval(walkTimer);
      const head = `<div class="wiz-head"><span class="mono small muted">STEP ${step + 1} OF ${STEPS.length}</span><b>${STEPS[step]}</b></div>`;
      let body = '', next = 'Next', canNext = true;
      if (step === 0) body = `<ul class="wiz-tips"><li>Put the Agent right against the window glass, camera facing out.</li><li>Switch the room light off behind it (reflections fool the camera at night). A dark cloth behind the phone helps.</li><li>Keep it out of direct sunlight so it doesn’t overheat.</li><li>It sees only what is outside; the picture never leaves this device.</li></ul>`;
      else if (step === 1) body = `<ul class="wiz-tips"><li>Fix it so it can’t slip: a phone holder, Blu Tack or a suction mount.</li><li>Plug it into a charger — PERIMETER WATCH uses more power.</li><li>Landscape (sideways) usually shows more of a driveway or garden.</li></ul>${camBox('view')}`;
      else if (step === 2) body = `<p class="small">Which area does this Agent watch?</p><div class="wiz-choices">${Object.entries(WATCH_LABEL).map(([k, l]) => `<button type="button" data-watch="${k}" aria-pressed="${draft.watch === k}">${esc(l[0].toUpperCase() + l.slice(1))}</button>`).join('')}</div>`;
      else if (step === 3) {
        body = `<p class="small"><b>Tap every square that shows something that isn’t yours</b> — a neighbour’s house or garden, the road, the pavement. Those squares are blacked out before anything looks at the picture.</p>
          <div class="wiz-mode row small"><label><input type="radio" name="paint" value="mask" checked> Privacy mask (black)</label><label><input type="radio" name="paint" value="ignore"> Ignore (mine, but don’t report)</label></div>
          ${camBox('edit')}
          <label class="wiz-agree"><input type="checkbox" data-agree ${draft.agreed ? 'checked' : ''}> Everything that isn’t masked is my own property.</label>`;
        canNext = draft.agreed;
      } else if (step === 4) {
        body = `<p class="small">Walk through the area now. Each time the Agent recognises you it is listed here (on this screen only — nothing is sent to HQ during the test).</p>${camBox('view')}<ol class="wiz-walk mono small" data-walk><li class="muted">Waiting… (${esc(recogniserState)})</li></ol>`;
      } else {
        body = `<dl class="kv small"><dt>Area</dt><dd>${esc(WATCH_LABEL[draft.watch])}</dd><dt>Privacy masks</dt><dd>${draft.mask.length} of ${COLS * ROWS} squares</dd><dt>Ignored</dt><dd>${draft.ignore.length} squares</dd><dt>Walk test</dt><dd>${draft.seen.length ? `${draft.seen.length} detection(s)` : 'nothing seen'}</dd></dl>
          <p class="small muted">Arming tells HQ the masks are confirmed. Until then this Agent can’t raise any alert.</p>`;
        next = 'Arm PERIMETER WATCH';
      }
      root.innerHTML = `<div class="wiz">${head}${body}<div class="row wiz-nav">${step ? '<button type="button" data-back class="btn-ghost">Back</button>' : ''}<span class="grow"></span><button type="button" class="btn-primary" data-next ${canNext ? '' : 'disabled'}>${next}</button></div></div>`;
      attachVideo();
      const grid = root.querySelector('[data-grid]');
      if (grid) grid.innerHTML = gridHtml(draft.mask, draft.ignore, step === 3);
      if (step === 4) walkTest();
    };
    function walkTest() {
      const list = root.querySelector('[data-walk]'), box = root.querySelector('[data-box]');
      let busy = false;
      walkTimer = setInterval(async () => {
        if (busy || !recogniser) { if (!recogniser && list) list.firstElementChild.textContent = `Waiting… (${recogniserState})`; return; }
        const pic = maskedPicture(draft.mask);
        if (!pic) return;
        busy = true;
        try {
          const d = pickDetection(await recogniser.detect(pic), { classes: 'all', confidence: s.confidence, mask: draft.mask, ignore: draft.ignore, w: DW, h: DH });
          if (d && list) {
            draft.seen.push(d);
            showBox(box, d);
            if (draft.seen.length === 1) list.innerHTML = '';
            list.insertAdjacentHTML('afterbegin', `<li>${new Date().toLocaleTimeString('en-GB')} · ${esc(d.label)} · ${d.score}%</li>`);
          }
        } catch { /* keep trying */ } finally { busy = false; }
      }, 900);
    }
    root.onclick = (e) => {
      const b = e.target.closest('button, input');
      if (!b) return;
      if (b.dataset.watch) { draft.watch = b.dataset.watch; root.querySelectorAll('[data-watch]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
      else if (b.dataset.cell != null && step === 3) {
        const i = Number(b.dataset.cell), paint = root.querySelector('input[name="paint"]:checked')?.value || 'mask';
        const inMask = draft.mask.includes(i), inIgnore = draft.ignore.includes(i);
        draft.mask = draft.mask.filter((x) => x !== i); draft.ignore = draft.ignore.filter((x) => x !== i);
        if (paint === 'mask' && !inMask) draft.mask.push(i);
        if (paint === 'ignore' && !inIgnore) draft.ignore.push(i);
        b.className = draft.mask.includes(i) ? 'masked' : draft.ignore.includes(i) ? 'ignored' : '';
        b.setAttribute('aria-pressed', String(draft.mask.includes(i) || draft.ignore.includes(i)));
      } else if ('agree' in b.dataset) { draft.agreed = b.checked; root.querySelector('[data-next]').disabled = !draft.agreed; }
      else if ('back' in b.dataset) { step--; show(); }
      else if ('next' in b.dataset) {
        if (step < STEPS.length - 1) { step++; show(); return; }
        clearInterval(walkTimer);
        root.onclick = null;
        ctx.setup({ watch: draft.watch, mask: draft.mask.sort((a, b2) => a - b2), ignore: draft.ignore.sort((a, b2) => a - b2), confirmed: true });
        root.innerHTML = '<p class="mono small">Arming… waiting for HQ to confirm.</p>';
        ctx.keepBright(false);
      }
    };
    show();
    return () => { clearInterval(walkTimer); root.onclick = null; };
  }
  function showBox(box, d) {
    if (!box) return;
    const [x, y, w, h] = d.box;
    Object.assign(box.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
    box.dataset.label = `${d.label} ${d.score}%`;
    box.hidden = false;
    clearTimeout(box._t); box._t = setTimeout(() => { box.hidden = true; }, 2500);
  }

  // ================= watching =================
  function watch() {
    root.innerHTML = `${camBox('view')}
      <div class="row"><span class="grow mono small" data-state>Watching ${esc(WATCH_LABEL[s.watch])}</span><button class="small" data-rerun>Run setup again</button></div>
      <div class="meter" aria-label="Movement"><div data-meter></div></div>
      <p class="small mono muted" data-rec></p>
      <p class="privacy">Black squares are privacy masks: they are blanked before anything looks at the picture. The picture never leaves this device — HQ only hears things like “Person detected (${esc(WATCH_LABEL[s.watch])})”.</p>`;
    attachVideo();
    root.querySelector('[data-grid]').innerHTML = gridHtml(s.mask, s.ignore, false);
    root.querySelector('[data-rerun]').addEventListener('click', () => { cleanup(); ctx.setup({ watch: s.watch, mask: s.mask, ignore: s.ignore, confirmed: false }); s = { ...s, masksConfirmed: false }; cleanup = wizard(); });
    const motion = makeDetector({ W: cam.W, H: cam.H, cols: COLS, rows: ROWS });
    const cover = makeCoverWatch();
    let lastReport = 0, checkUntil = 0, busy = false, frames = 0, peak = 0;
    const $ = (q) => root.querySelector(q);
    const t = setInterval(async () => {
      if (stopped) return;
      if (!cam.alive()) { ctx.status({ state: 'camera paused' }); return; }
      const f = cam.grey();
      if (!f) return;
      maskFrame(f, cam.W, cam.H, s.mask); // privacy masks first
      const r = motion.step(f, { sensitivity: s.sensitivity, ignore: [...s.mask, ...s.ignore] });
      const tc = cover(frameStats(f), Date.now());
      if (tc === 'covered') ctx.report('tamper', 'Camera view blocked (lens covered?)', { type: 'covered' }, 'warn');
      frames++; peak = Math.max(peak, r.fraction);
      const m = $('[data-meter]'); if (m) m.style.width = `${Math.min(100, r.fraction * 400)}%`;
      const rec = $('[data-rec]'); if (rec && frames % 10 === 0) rec.textContent = `Recogniser: ${recogniser ? (speed.slow ? 'too slow on this device — motion only' : `ready${speed.avg ? ` (${speed.avg} ms per look)` : ''}`) : recogniserState}`;
      if (frames % 10 === 0) { ctx.status({ state: recogniser && !speed.slow ? 'watching' : 'watching (motion only)', level: Math.round(peak * 1000) / 10 }); peak = 0; }
      const now = Date.now();
      if (r.motion) checkUntil = now + 3000; // movement: look at what it is for the next 3 seconds
      if (now > checkUntil || busy || now - lastReport < s.cooldown * 1000) return;
      if (!recogniser || speed.slow) {
        if (!r.motion) return;
        lastReport = now;
        ctx.report('perimeter', describe('motion', s.watch), { class: 'motion', zone: s.watch, area: Math.round(r.fraction * 1000) / 10 }, 'info');
        return;
      }
      const pic = maskedPicture(s.mask);
      if (!pic) return;
      busy = true;
      const t0 = performance.now();
      try {
        const d = pickDetection(await recogniser.detect(pic), { classes: s.classes, confidence: s.confidence, mask: s.mask, ignore: s.ignore, w: DW, h: DH });
        speed.add(performance.now() - t0);
        if (d && !stopped) {
          lastReport = Date.now(); checkUntil = 0;
          ctx.report('perimeter', describe(d.group, s.watch), { class: d.group, zone: s.watch, score: d.score }, 'info');
          showBox($('[data-box]'), d);
          const st = $('[data-state]'); if (st) st.textContent = `${describe(d.group, s.watch)} at ${new Date().toLocaleTimeString('en-GB')}`;
          navigator.vibrate?.(60);
        }
      } catch { speed.add(5000); } finally { busy = false; }
    }, 250);
    return () => clearInterval(t);
  }

  let cleanup = s.masksConfirmed ? watch() : wizard();
  return {
    update(next) {
      const restart = next.camera !== s.camera;
      const armedNow = next.masksConfirmed && !s.masksConfirmed;
      s = next;
      if (restart) return ctx.restart?.();
      if (armedNow || (!s.masksConfirmed && !root.querySelector('.wiz'))) { cleanup(); cleanup = s.masksConfirmed ? watch() : wizard(); }
    },
    stop() { stopped = true; cleanup(); cam.stop(); ctx.keepBright(false); },
  };
}
