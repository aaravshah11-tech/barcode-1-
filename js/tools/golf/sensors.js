// Phone motion sensors (DeviceMotionEvent), including the iPhone permission prompt.

/** iPhones need an explicit "Allow motion" tap. Must be called from a button tap. */
export async function requestMotionPermission() {
  const DME = window.DeviceMotionEvent;
  if (!DME) return 'unsupported';
  if (typeof DME.requestPermission === 'function') {
    try { return (await DME.requestPermission()) === 'granted' ? 'granted' : 'denied'; } catch { return 'denied'; }
  }
  return 'granted';
}

/**
 * Start listening. onSample({ t, gx, gy, gz, ax, ay, az }) for each reading.
 * Returns stop(). Calls onNoData() if nothing arrives within 1.5 s (e.g. a laptop).
 */
export function listen(onSample, onNoData) {
  let got = false;
  const t0 = performance.now();
  const handler = (e) => {
    const r = e.rotationRate;
    if (!r || (r.alpha == null && r.beta == null && r.gamma == null)) return;
    got = true;
    const a = e.accelerationIncludingGravity || e.acceleration || {};
    onSample({
      t: Math.round(performance.now() - t0),
      gx: r.beta || 0, gy: r.gamma || 0, gz: r.alpha || 0, // degrees per second around x, y, z
      ax: a.x || 0, ay: a.y || 0, az: a.z || 0,
    });
  };
  window.addEventListener('devicemotion', handler);
  const timer = setTimeout(() => { if (!got) onNoData?.(); }, 1500);
  return () => { clearTimeout(timer); window.removeEventListener('devicemotion', handler); };
}

// Compact storage: arrays instead of objects, rounded.
export function pack(samples) {
  const t0 = samples[0]?.t || 0;
  const k = ['gx', 'gy', 'gz', 'ax', 'ay', 'az'];
  const out = { t: samples.map((s) => Math.round(s.t - t0)) };
  for (const key of k) out[key] = samples.map((s) => Math.round(s[key] * 10) / 10);
  return out;
}
export function unpack(p) {
  if (!p?.t) return [];
  return p.t.map((t, i) => ({ t, gx: p.gx[i], gy: p.gy[i], gz: p.gz[i], ax: p.ax[i], ay: p.ay[i], az: p.az[i] }));
}
