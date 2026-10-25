// SOUND LEVEL: loudness in decibels, measured here. Nothing is recorded, saved or sent —
// HQ only receives numbers ("Loud sound: 82 dB").
export async function start(ctx) {
  let s = ctx.settings;
  ctx.root.innerHTML = `
    <div class="readout" data-db>– <small>dB</small></div>
    <div class="meter" aria-label="Loudness"><div data-meter></div></div>
    <div class="row"><span class="grow mono small" data-info>Starting microphone…</span><span class="mono small muted" data-thr></span></div>
    <p class="privacy">Only the loudness number is used. Nothing is recorded, saved or sent — HQ just hears “loud sound, 82 dB”.</p>`;
  const $ = (q) => ctx.root.querySelector(q);
  const showThr = () => { $('[data-thr]').textContent = `alert above ${s.threshold} dB`; };
  showThr();
  let stream, ac;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  } catch (e) {
    $('[data-info]').textContent = e.name === 'NotAllowedError' ? 'Microphone permission was refused. Allow it for this site, then restart the Agent page.' : `Microphone unavailable: ${e.message}`;
    ctx.status({ state: 'microphone blocked' });
    return { stop() {} };
  }
  ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') await ctx.withTap('Start listening', () => ac.resume()).catch(() => {});
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 2048;
  src.connect(an); // not connected to the speakers: nothing is played or kept
  const buf = new Float32Array(an.fftSize);
  let above = 0, last = 0, peak = 0, windowMax = 0, ticks = 0, smooth = 0;
  const TICK = 100; // ms per reading

  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = Math.max(0, 20 * Math.log10(rms + 1e-9) + s.calibration);
    smooth = smooth ? smooth * 0.6 + db * 0.4 : db;
    windowMax = Math.max(windowMax, db);
    $('[data-db]').innerHTML = `${Math.round(smooth)} <small>dB</small>`;
    $('[data-meter]').style.width = `${Math.min(100, (smooth / 110) * 100)}%`;
    $('[data-meter]').style.background = smooth >= s.threshold ? 'var(--red)' : 'var(--green)';
    const now = Date.now();
    if (db >= s.threshold) {
      if (!above) peak = 0;
      above++; // each reading covers ~100 ms of sound
      peak = Math.max(peak, db);
      if (above * TICK >= s.minMs && now - last > s.cooldown * 1000) {
        last = now;
        ctx.report('sound', `Loud sound: ${Math.round(peak)} dB`, { db: Math.round(peak) }, 'info');
        $('[data-info]').textContent = `Reported ${Math.round(peak)} dB at ${new Date().toLocaleTimeString('en-GB')}`;
      }
    } else above = 0;
    if (++ticks % 20 === 0) { ctx.status({ state: 'listening', level: Math.round(windowMax) }); windowMax = 0; if (!$('[data-info]').textContent.startsWith('Reported')) $('[data-info]').textContent = 'Listening for loud sounds'; }
  }, TICK);

  return {
    update(next) { s = next; showThr(); },
    stop() { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); },
  };
}
