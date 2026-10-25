// DOOR TRIPWIRE: stick the Agent to a door; it feels the door swing with its motion sensors (no camera).
import { makeDoor } from '../lib/door-core.js';

export async function start(ctx) {
  let s = ctx.settings;
  ctx.root.innerHTML = `
    <div class="readout" data-state>…</div>
    <div class="row"><span class="grow mono small" data-info>Starting sensors…</span><button class="small" data-cal>Door is closed now</button></div>
    <p class="privacy">Stick this device flat on the door (screen facing you), near the handle edge. No camera or microphone is used.</p>`;
  const $ = (q) => ctx.root.querySelector(q);
  const door = makeDoor({ angle: s.angle });
  let last = 0, lastT = 0, gotGyro = false, gotAny = false, bumpAt = 0, lastShown = '';

  // iPhones ask permission for motion sensors, and only from a tap.
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    const res = await ctx.withTap('Allow motion sensors', () => DeviceMotionEvent.requestPermission()).catch(() => 'denied');
    if (res !== 'granted') { $('[data-info]').textContent = 'Motion sensors were refused. iPhone: Settings › Safari › Motion & Orientation Access, then restart the Agent page. Android: tap the 🔒 by the address › Permissions › Motion sensors › Allow.'; ctx.status({ state: 'sensors blocked' }); return { stop() {} }; }
  }
  const show = () => {
    const txt = door.open ? 'OPEN' : 'CLOSED';
    if (txt !== lastShown) { $('[data-state]').textContent = txt; $('[data-state]').style.color = door.open ? 'var(--amber)' : 'var(--green)'; lastShown = txt; }
  };
  show();
  const onMotion = (e) => {
    gotAny = true;
    const now = performance.now();
    // Time between readings: the sensor says (interval, ms — very old iPhones give seconds); otherwise measure it.
    const iv = e.interval > 1 ? e.interval : e.interval > 0 ? e.interval * 1000 : lastT ? now - lastT : 16;
    const dt = Math.min(100, Math.max(5, iv));
    lastT = now;
    const r = e.rotationRate;
    let result = null;
    if (r && (r.alpha != null || r.beta != null || r.gamma != null)) {
      gotGyro = true;
      result = door.step(r, dt);
    } else {
      // No gyroscope: a sharp knock/jolt counts as the door moving.
      const a = e.acceleration || {};
      const jolt = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      if (jolt > 2.5 && now - bumpAt > s.cooldown * 1000) { bumpAt = now; result = 'moved'; }
    }
    const t = Date.now();
    if (result === 'opened' && t - last > s.cooldown * 1000) { last = t; ctx.report('door', 'Door opened', { angle: Math.round(Math.abs(door.turned)) }, 'info'); navigator.vibrate?.(80); }
    else if (result === 'closed' && s.reportClose) ctx.report('door', 'Door closed', {}, 'info');
    else if (result === 'moved') ctx.report('door', 'Door moved', {}, 'info');
    if (result) { show(); ctx.status({ state: door.open ? 'door open' : 'door closed' }); }
  };
  addEventListener('devicemotion', onMotion);
  const check = setTimeout(() => {
    $('[data-info]').textContent = !gotAny ? 'No motion sensors found on this device — try another Agent for this mission.' : gotGyro ? 'Watching the door' : 'No gyroscope: reporting bumps instead of swings';
    ctx.status({ state: gotAny ? 'door closed' : 'no sensors' });
  }, 2000);
  $('[data-cal]').addEventListener('click', () => { door.calibrate(); show(); $('[data-info]').textContent = 'Calibrated: door closed'; ctx.status({ state: 'door closed' }); });
  return {
    update(next) { s = next; door.setAngle(s.angle); },
    stop() { removeEventListener('devicemotion', onMotion); clearTimeout(check); },
  };
}
