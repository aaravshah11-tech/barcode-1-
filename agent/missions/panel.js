// DOOR PANEL: one big button. Pressing it alerts HQ (a DIY doorbell / "knock knock" button).
export function start(ctx) {
  let s = ctx.settings;
  ctx.keepBright(true);
  ctx.root.innerHTML = `
    <button class="knock" data-knock aria-describedby="knock-help"></button>
    <p class="mono" style="text-align:center;min-height:1.6em" data-said aria-live="assertive"></p>
    <p class="small muted" id="knock-help" style="text-align:center">Press once — HQ is told straight away.</p>`;
  const $ = (q) => ctx.root.querySelector(q);
  const label = () => { $('[data-knock]').textContent = s.label || 'CALL HQ'; };
  label();
  let last = 0, audio = null;
  const chime = () => {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; const t = audio.currentTime + i * 0.22; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.5); });
    } catch { /* no sound */ }
  };
  $('[data-knock]').addEventListener('click', () => {
    const now = Date.now();
    if (now - last < s.cooldown * 1000) { $('[data-said]').textContent = 'HQ already knows — please wait.'; return; }
    last = now;
    const where = ctx.agent().name;
    ctx.report('knock', `Door panel pressed${where ? ` at ${where}` : ''}`, {}, 'warn');
    chime();
    navigator.vibrate?.(120);
    $('[data-said]').textContent = 'HQ NOTIFIED ✓';
    setTimeout(() => { $('[data-said]').textContent = ''; }, 5000);
  });
  ctx.status({ state: 'ready' });
  return { update(next) { s = next; label(); }, stop() { ctx.keepBright(false); } };
}
