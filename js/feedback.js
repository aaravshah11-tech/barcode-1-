// Beep + vibration feedback for scans.
import { getSetting } from './store.js';

let ctx = null;

/** Call from a tap handler so iPhones allow sound later. */
export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

const TONES = {
  ok: [[1175, 0.09]],
  dup: [[523, 0.09], [523, 0.09]],
  err: [[196, 0.25]],
};
const BUZZ = { ok: 60, dup: [50, 60, 50], err: [200] };

export function feedback(kind = 'ok') {
  if (getSetting('sound', true)) {
    try {
      unlockAudio();
      let t = ctx.currentTime;
      for (const [freq, dur] of TONES[kind] || TONES.ok) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        t += dur + 0.07;
      }
    } catch { /* ignore */ }
  }
  if (getSetting('vibrate', true)) navigator.vibrate?.(BUZZ[kind] || BUZZ.ok);
}
