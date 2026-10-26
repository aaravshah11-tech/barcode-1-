// Sound design: soft beeps, scan sweeps and alert tones, made on the fly with the Web Audio API
// (no sound files). Volume and mute are saved per device.
const KEY = 'sentinel.sfx';
let ctx = null, master = null;
let prefs = { volume: 0.5, muted: false };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ignore */ }

export const sfxPrefs = () => ({ ...prefs });
export function setSfx(p) {
  prefs = { ...prefs, ...p };
  prefs.volume = Math.min(1, Math.max(0, Number(prefs.volume) || 0));
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  if (master) master.gain.value = prefs.muted ? 0 : prefs.volume * 0.6;
  listeners.forEach((f) => f(sfxPrefs()));
}
const listeners = new Set();
export const onSfx = (f) => listeners.add(f);

function audio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = prefs.muted ? 0 : prefs.volume * 0.6;
      master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only allow sound after the first tap/click/key.
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => audio(), { capture: true, once: true });

function tone(freq, { start = 0, dur = 0.12, type = 'sine', gain = 0.25, to = null } = {}) {
  const c = audio();
  if (!c || prefs.muted || !prefs.volume) return;
  const t = c.currentTime + start;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

const SOUNDS = {
  click: () => tone(1800, { dur: 0.04, type: 'square', gain: 0.05 }),
  blip: () => { tone(1320, { dur: 0.07, gain: 0.12 }); tone(1760, { start: 0.07, dur: 0.07, gain: 0.1 }); },
  beep: () => tone(980, { dur: 0.14, gain: 0.16 }),
  scan: () => tone(300, { dur: 1.1, type: 'sawtooth', gain: 0.05, to: 2400 }),
  granted: () => { tone(880, { dur: 0.12, gain: 0.16 }); tone(1320, { start: 0.12, dur: 0.22, gain: 0.16 }); },
  denied: () => { tone(220, { dur: 0.25, type: 'square', gain: 0.1 }); tone(160, { start: 0.25, dur: 0.35, type: 'square', gain: 0.1 }); },
  alert: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 990, { start: i * 0.22, dur: 0.2, type: 'triangle', gain: 0.2 }); },
  warn: () => { tone(740, { dur: 0.16, type: 'triangle', gain: 0.16 }); tone(560, { start: 0.18, dur: 0.2, type: 'triangle', gain: 0.14 }); },
  boot: () => { [220, 330, 440, 660, 880].forEach((f, i) => tone(f, { start: i * 0.09, dur: 0.16, gain: 0.1 })); tone(1760, { start: 0.55, dur: 0.5, gain: 0.08 }); },
  type: () => tone(2400 + Math.random() * 600, { dur: 0.02, type: 'square', gain: 0.02 }),
};
export function sfx(name) { try { SOUNDS[name]?.(); } catch { /* sound is optional */ } }
