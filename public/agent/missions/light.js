// LIGHT CHECK: notices lights switched on/off from the camera's overall brightness. No images are sent.
import { openCamera } from '/agent/lib/camera.js';

export async function start(ctx) {
  let s = ctx.settings;
  ctx.root.innerHTML = `
    <div class="readout" data-state>…</div>
    <div class="meter" aria-label="Brightness"><div data-meter></div></div>
    <div class="row"><span class="grow mono small" data-info>Starting camera…</span><span class="mono small muted" data-pct></span></div>
    <p class="privacy">Point the camera at the room (not at a window). Only the overall brightness number is used — HQ hears “lights switched on”.</p>`;
  const $ = (q) => ctx.root.querySelector(q);
  let cam;
  try { cam = await openCamera(s.camera); } catch (e) { $('[data-info]').textContent = e.message; ctx.status({ state: 'camera blocked' }); return { stop() {} }; }
  let state = null, streak = 0, frames = 0, sum = 0;
  const timer = setInterval(() => {
    const f = cam.grey();
    if (!f) return;
    let t = 0;
    for (let i = 0; i < f.length; i++) t += f[i];
    const pct = (t / f.length / 255) * 100;
    frames++; sum += pct;
    $('[data-pct]').textContent = `${Math.round(pct)}% bright`;
    $('[data-meter]').style.width = `${pct}%`;
    if (frames < 5) return; // camera adjusting
    const want = pct > s.threshold + 4 ? 'on' : pct < s.threshold - 4 ? 'off' : state;
    streak = want && want !== state ? streak + 1 : 0;
    if (want && (state === null || streak >= 3)) {
      const changed = state !== null;
      state = want;
      streak = 0;
      $('[data-state]').textContent = state === 'on' ? 'LIGHTS ON' : 'LIGHTS OFF';
      $('[data-state]').style.color = state === 'on' ? 'var(--amber)' : 'var(--green)';
      if (changed) ctx.report('light', state === 'on' ? 'Lights switched on' : 'Lights switched off', { brightness: Math.round(pct) }, 'info');
      $('[data-info]').textContent = changed ? `${state === 'on' ? 'On' : 'Off'} at ${new Date().toLocaleTimeString('en-GB')}` : 'Watching the lights';
      ctx.status({ state: `lights ${state}`, level: Math.round(pct) });
    }
    if (frames % 15 === 0) { ctx.status({ state: state ? `lights ${state}` : 'measuring', level: Math.round(sum / 15) }); sum = 0; }
  }, 200);
  return {
    update(next) { const cam2 = next.camera !== s.camera; s = next; if (cam2) ctx.restart(); },
    stop() { clearInterval(timer); cam.stop(); },
  };
}
