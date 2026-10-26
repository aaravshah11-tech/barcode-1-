// VOICE COMMANDS — push-to-talk, OFF by default, set per device.
//
// Privacy: browsers don't understand speech on their own. While you HOLD the microphone button,
// the browser sends that audio to its maker's speech service (Google for Chrome, Microsoft for
// Edge, Apple for Safari) and gets the words back. Nothing listens when you're not holding it,
// and SENTINEL never records or keeps the audio. The words are handled like a typed command.

const KEY = 'sentinel.voice';
export const voicePrefs = () => { try { return { on: false, reply: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { on: false, reply: true }; } };
export const setVoicePrefs = (p) => { try { localStorage.setItem(KEY, JSON.stringify({ ...voicePrefs(), ...p })); } catch { /* private window */ } dispatchEvent(new Event('sentinel:voice')); };
const Recognition = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const voiceSupported = () => !!Recognition();

/** Who hears the audio, in plain words, for the browser in use. */
export function speechProvider() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Microsoft (Edge’s speech service)';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Android/.test(ua)) return 'Apple (Safari’s speech service)';
  return 'Google (Chrome’s speech service)';
}
export const PRIVACY = () => `While you hold the microphone button, this browser sends the sound of your voice to ${speechProvider()} to turn it into words. Nothing is heard when you’re not holding it, and SENTINEL doesn’t record or keep the audio. Voice commands are switched on for this device only.`;

/** Say something out loud (on this device), preferring a voice built into the device. */
export function speak(text) {
  if (!text || !('speechSynthesis' in window) || !voicePrefs().reply) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\bHQ\b/g, 'H Q'));
    const v = speechSynthesis.getVoices().find((x) => x.localService && /^en(-GB)?/i.test(x.lang)) || null;
    if (v) u.voice = v;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* no speech on this device */ }
}

/**
 * Push-to-talk. start() when the button goes down, stop() when it's released; the words are then
 * passed to onText(text). onState({ listening, interim, error }) keeps the screen up to date.
 */
export function createPushToTalk({ onText, onState }) {
  let rec = null, finalText = '', interim = '', errored = false;
  function start() {
    if (rec || !voicePrefs().on) return;
    const R = Recognition();
    if (!R) { onState({ listening: false, error: 'This browser can’t do voice commands. Use Chrome or Edge.' }); return; }
    finalText = ''; interim = ''; errored = false;
    rec = new R();
    rec.lang = navigator.language || 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += ` ${e.results[i][0].transcript}`;
        else interim += e.results[i][0].transcript;
      }
      onState({ listening: true, interim: `${finalText} ${interim}`.trim() });
    };
    rec.onerror = (e) => {
      errored = true;
      const why = { 'not-allowed': 'Microphone blocked. Allow the microphone for this site (the icon in the address bar) and try again.', 'service-not-allowed': 'Microphone blocked. Allow the microphone for this site and try again.', network: 'The speech service couldn’t be reached. Check the internet connection.', 'no-speech': 'Didn’t hear anything. Hold the button while you speak.', 'audio-capture': 'No microphone found on this device.' }[e.error];
      if (e.error !== 'aborted') onState({ listening: false, error: why || `Voice error: ${e.error}` });
    };
    rec.onend = () => {
      const text = `${finalText} ${interim}`.trim();
      rec = null;
      onState({ listening: false });
      if (text && !errored) onText(text);
    };
    try { rec.start(); onState({ listening: true, interim: '' }); } catch (x) { rec = null; onState({ listening: false, error: x.message }); }
  }
  function stop() { try { rec?.stop(); } catch { /* already stopped */ } }
  return { start, stop, get listening() { return !!rec; } };
}
