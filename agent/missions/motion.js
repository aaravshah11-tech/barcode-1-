// MOTION WATCH: spots movement with the camera. The picture stays on this device —
// HQ only ever receives "Motion detected" plus how much of the view changed.
import { openCamera } from '../lib/camera.js';
import { makeDetector } from '../lib/motion-core.js';
import { frameStats, makeCoverWatch } from '../lib/tamper-core.js';

const COLS = 8, ROWS = 6;

export async function start(ctx) {
  let s = ctx.settings;
  ctx.root.innerHTML = `
    <div class="cam-wrap"><div class="zone-grid view" data-grid style="grid-template-columns:repeat(${COLS},1fr);grid-template-rows:repeat(${ROWS},1fr)"></div><canvas class="hot" data-hot width="${COLS}" height="${ROWS}"></canvas></div>
    <div class="row"><span class="grow mono small" data-state>Starting camera…</span><button class="small" data-zones>Ignore zones</button></div>
    <div class="meter" aria-label="Movement"><div data-meter></div></div>
    <p class="privacy">HQ only hears “motion detected”. The picture is only sent if HQ opens Live view — then a red LIVE VIEW banner shows at the top. Nothing is recorded or saved.</p>`;
  const $ = (q) => ctx.root.querySelector(q);
  const wrap = $('.cam-wrap');
  let cam;
  try { cam = await openCamera(s.camera); } catch (e) { $('[data-state]').textContent = e.message; $('[data-state]').classList.add('c-red'); ctx.status({ state: 'camera blocked' }); return { stop() {} }; }
  wrap.prepend(cam.video);
  const det = makeDetector({ W: cam.W, H: cam.H, cols: COLS, rows: ROWS });
  let lastReport = 0, editing = false, frames = 0, peak = 0;
  const cover = makeCoverWatch(); // tamper: lens covered?

  // ----- ignore zones (picked here on the Agent; only cell numbers go to HQ) -----
  const grid = $('[data-grid]');
  const drawGrid = () => {
    grid.innerHTML = Array.from({ length: COLS * ROWS }, (_, i) => `<button type="button" data-cell="${i}" aria-pressed="${s.ignore.includes(i)}" aria-label="Zone ${i + 1}" tabindex="${editing ? 0 : -1}"></button>`).join('');
  };
  drawGrid();
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cell]');
    if (!b || !editing) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
  });
  $('[data-zones]').addEventListener('click', () => {
    editing = !editing;
    grid.classList.toggle('view', !editing);
    $('[data-zones]').textContent = editing ? 'Save zones' : 'Ignore zones';
    if (editing) { ctx.keepBright(true); $('[data-state]').textContent = 'Tap squares to ignore (e.g. a TV or a window), then Save zones.'; drawGrid(); return; }
    ctx.keepBright(false);
    const cells = [...grid.querySelectorAll('[aria-pressed="true"]')].map((b) => Number(b.dataset.cell));
    s = { ...s, ignore: cells };
    ctx.setGrid('ignore', cells);
    $('[data-state]').textContent = cells.length ? `${cells.length} zone(s) ignored` : 'Watching everything';
  });

  // ----- watch -----
  const hot = $('[data-hot]').getContext('2d');
  const timer = setInterval(() => {
    if (!cam.alive()) { $('[data-state]').textContent = 'Camera stopped — keep this screen open and in front.'; ctx.status({ state: 'camera paused' }); return; }
    const f = cam.grey();
    if (!f) return;
    const r = det.step(f, { sensitivity: s.sensitivity, ignore: s.ignore });
    const tc = cover(frameStats(f), Date.now());
    if (tc === 'covered') ctx.report('tamper', 'Camera view blocked (lens covered?)', { type: 'covered' }, 'warn');
    else if (tc === 'uncovered') ctx.report('tamper', 'Camera view clear again', { type: 'uncovered' }, 'info');
    frames++;
    peak = Math.max(peak, r.fraction);
    $('[data-meter]').style.width = `${Math.min(100, r.fraction * 400)}%`;
    hot.clearRect(0, 0, COLS, ROWS);
    hot.fillStyle = 'rgba(255,182,39,.45)';
    for (const c of r.cells) if (!s.ignore.includes(c)) hot.fillRect(c % COLS, Math.floor(c / COLS), 1, 1);
    const now = Date.now();
    if (r.motion && now - lastReport > s.cooldown * 1000) {
      lastReport = now;
      const pct = Math.round(r.fraction * 1000) / 10;
      ctx.report('motion', `Motion detected (${pct}% of view)`, { area: pct, zones: r.cells.length }, 'info');
      if (!editing) $('[data-state]').textContent = `Motion reported at ${new Date().toLocaleTimeString('en-GB')}`;
      navigator.vibrate?.(60);
    } else if (!editing && frames % 25 === 0 && now - lastReport > 5000) {
      $('[data-state]').textContent = r.lighting ? 'Lighting changed — adjusting' : 'Watching';
    }
    if (frames % 10 === 0) { ctx.status({ state: 'watching', level: Math.round(peak * 1000) / 10 }); peak = 0; }
  }, 200);

  return {
    update(next) {
      const camChanged = next.camera !== s.camera;
      s = next;
      if (!editing) drawGrid();
      if (camChanged) ctx.restart?.();
    },
    stop() { clearInterval(timer); cam.stop(); ctx.keepBright(false); },
  };
}
