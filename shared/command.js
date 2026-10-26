// COMMANDS: what the terminal and voice commands understand. Pure (no page access), unit tested.
//
// parseCommand('mode night', ctx)            → { cmd: 'mode', mode: 'night' }
// parseCommand('switch to night mode', ctx)  → the same (voice phrasing)
// ctx = { agents: [{ id, codename, name, label }], rooms: [{ id, name }] } — for names like "kitchen" or "nightjar".

import { MODES } from './threat.js';

export const COMMANDS = [
  ['help', 'help', 'List the commands'],
  ['status', 'status', 'Situation report: threat level, mode, Agents'],
  ['mode', 'mode <home|away|night|lockdown>', 'Change the security mode'],
  ['agents', 'agents', 'List Agents and whether they’re online'],
  ['find', 'find <agent>', 'Make an Agent flash its codename (and fly to it on the map)'],
  ['send', 'send <all|agent|room> <message>', 'Send a message (also: broadcast <message>)'],
  ['log', 'log [number] | alerts', 'Show the latest Mission Log entries'],
  ['net', 'net', 'Internet status'],
  ['speedtest', 'speedtest', 'Run an internet speed test'],
  ['standdown', 'standdown', 'Silence the alarm on every Agent'],
  ['panic', 'panic', 'Raise PANIC (asks first)'],
  ['map', 'map <3d|plan|radar>', 'Switch the map view'],
  ['live', 'live <agent>', 'Open Live view of an Agent’s camera'],
  ['theme', 'theme <mi6|classic|redops>', 'Change the look'],
  ['time', 'time', 'Local time and date'],
  ['whoami', 'whoami', 'Who is logged in here'],
  ['lock', 'lock', 'Lock this screen'],
  ['clear', 'clear', 'Clear the terminal'],
];
export const THEME_NAMES = ['mi6', 'classic', 'redops'];

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const FILLER = new Set(['sentinel', 'hq', 'ok', 'okay', 'hey', 'please', 'computer']);
const POLITE = new Set(['please', 'thanks']);

/** Find an Agent by codename, name, label ("agent-01", "agent 1", "01") or its room. */
export function findAgent(text, ctx = {}) {
  const t = norm(text).replace(/^the /, '');
  if (!t) return null;
  const agents = ctx.agents || [];
  const num = t.match(/^(?:agent[\s-]*)?0*(\d{1,3})$/);
  const bare = t.replace(/^agent /, '');
  for (const a of agents) {
    const keys = [a.codename, a.name, a.label].filter(Boolean).map(norm);
    if (keys.includes(t) || keys.includes(bare)) return a;
    if (num && Number(String(a.label || '').replace(/\D/g, '')) === Number(num[1])) return a;
  }
  const room = (ctx.rooms || []).find((r) => norm(r.name) === t || norm(r.name) === t.replace(/^the /, ''));
  if (room) return agents.find((a) => a.place?.roomId === room.id) || null;
  return null;
}

/** Who a message goes to: 'all', an Agent id or 'room:<id>'. Finds the longest name at the start of `rest`. */
function splitTarget(rest, ctx) {
  const words = rest.split(' ');
  if (/^(all|everyone|everybody|all agents)$/.test(words[0]) || (words[0] === 'all' && words[1] === 'agents')) return { target: 'all', text: words.slice(words[1] === 'agents' ? 2 : 1).join(' ') };
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const head = words.slice(0, n).join(' ').replace(/^the /, '');
    const room = (ctx.rooms || []).find((r) => norm(r.name) === head);
    if (room) return { target: `room:${room.id}`, text: words.slice(n).join(' ') };
    const a = findAgent(head, ctx);
    if (a) return { target: a.id, text: words.slice(n).join(' ') };
  }
  return null;
}

export function parseCommand(input, ctx = {}) {
  // words as typed/heard, each with its plain lower-case form
  const tokens = String(input || '').trim().split(/\s+/).map((r) => ({ r, n: norm(r) })).filter((x) => x.n);
  while (tokens.length > 1 && FILLER.has(tokens[0].n)) tokens.shift();
  while (tokens.length > 1 && POLITE.has(tokens.at(-1).n)) tokens.pop();
  if (tokens.length > 2 && tokens.at(-2).n === 'thank' && tokens.at(-1).n === 'you') tokens.splice(-2);
  const t = tokens.map((x) => x.n).join(' ');
  if (!t) return { cmd: 'none' };
  const [w, ...restW] = t.split(' ');
  const rest = restW.join(' ');
  // Messages keep their original wording (capitals, punctuation): the last N words as typed.
  const original = (after) => tokens.slice(-after.split(' ').length).map((x) => x.r).join(' ');

  if (/^(help|\?|commands)$/.test(t) || /^what can (you|i) (do|say)/.test(t)) return { cmd: 'help' };
  if (/^(status|sitrep|report)$/.test(t) || /^(status|situation) report$/.test(t) || /^(whats|what is) (the )?(status|situation|threat level)/.test(t)) return { cmd: 'status' };
  if (/^(agents|list agents|show agents)$/.test(t) || /^(who|which agents) (is|are) online/.test(t)) return { cmd: 'agents' };
  if (/^(clear|cls)$/.test(t)) return { cmd: 'clear' };
  if (/^(time|date)$/.test(t) || /^what (time|day) is it/.test(t) || /^whats the (time|date)/.test(t)) return { cmd: 'time' };
  if (/^(whoami|who am i)$/.test(t)) return { cmd: 'whoami' };
  if (/^lock( (the )?(screen|hq|dashboard))?$/.test(t)) return { cmd: 'lock' };
  if (/^(net|network|internet)( status)?$/.test(t) || /^is the internet (up|down|working)/.test(t)) return { cmd: 'net' };
  if (/^(speedtest|speed test)$/.test(t) || /^(run|start|do) (an? )?(internet )?speed ?test/.test(t)) return { cmd: 'speedtest' };
  if (/^(standdown|stand down)( (the )?alarm)?$/.test(t) || /^(stop|silence|cancel) (the )?(alarm|siren)s?$/.test(t)) return { cmd: 'standdown' };
  if (/^(panic|raise panic|panic button)$/.test(t)) return { cmd: 'panic' };

  // security mode: "mode night", "night mode", "switch to night", "arm away", "lockdown", "goodnight"
  const modeWord = t.match(/\b(home|away|night|lockdown|lock down)\b/);
  if (modeWord && (/^(mode|set|switch|change|go|arm|enter|activate|security)\b/.test(t) || /\bmode$/.test(t) || t === modeWord[0] || /^(initiate|begin) lock ?down$/.test(t))) {
    return { cmd: 'mode', mode: modeWord[1].replace(' ', '') };
  }
  if (w === 'mode') return { cmd: 'error', error: `Which mode? ${MODES.join(', ')}.` };
  if (/^(goodnight|good night)$/.test(t)) return { cmd: 'mode', mode: 'night' };

  if (/^(log|logs|mission log|show (the )?log)( \d+)?$/.test(t)) return { cmd: 'log', n: Math.min(50, Number(t.match(/\d+/)?.[0]) || 10) };
  if (/^(alerts|show alerts|any alerts)$/.test(t)) return { cmd: 'log', n: 10, alerts: true };

  const view = t.match(/^(?:map |show (?:the )?(?:map )?|view )?(3d|3 d|plan|radar)(?: (?:map|view))?$/);
  if (view && (w === 'map' || w === 'show' || w === 'view' || restW.length <= 1)) return { cmd: 'map', view: view[1].replace(' ', '') };
  if (w === 'map') return { cmd: 'error', error: 'Map views: 3d, plan, radar.' };

  if (w === 'theme') return THEME_NAMES.includes(rest.replace(/\s/g, '')) ? { cmd: 'theme', theme: rest.replace(/\s/g, '') } : { cmd: 'error', error: `Themes: ${THEME_NAMES.join(', ')}.` };

  const findM = t.match(/^(?:find|locate|ping|where is|wheres) (.+)$/);
  if (findM) { const a = findAgent(findM[1], ctx); return a ? { cmd: 'find', agentId: a.id } : { cmd: 'error', error: `No Agent called “${findM[1]}”. Type agents to list them.` }; }

  const liveM = t.match(/^(?:live|live view|show (?:the )?camera(?: (?:in|of|on))?|camera) (.+)$/);
  if (liveM) { const a = findAgent(liveM[1], ctx); return a ? { cmd: 'live', agentId: a.id } : { cmd: 'error', error: `No Agent called “${liveM[1]}”.` }; }

  // messages
  if (/^(broadcast|announce|say)$/.test(w)) return rest ? { cmd: 'send', target: 'all', text: original(rest) } : { cmd: 'error', error: 'Broadcast what? e.g. broadcast Dinner is ready' };
  if (/^(send|tell|message|msg)$/.test(w)) {
    const r = rest.replace(/^(a )?message to /, '').replace(/^to /, '');
    const sp = splitTarget(r, ctx);
    if (!sp) return { cmd: 'error', error: 'Send to whom? e.g. send all Dinner is ready · send kitchen Come down' };
    const text = sp.text.replace(/^(that|to say) /, '');
    if (!text) return { cmd: 'error', error: 'What’s the message?' };
    return { cmd: 'send', target: sp.target, text: original(text) };
  }
  return { cmd: 'unknown', text: t };
}

/** Suggest a completion for the first word (Tab in the terminal). */
export function complete(prefix) {
  const p = norm(prefix);
  if (!p || p.includes(' ')) return null;
  const hits = COMMANDS.map(([k]) => k).filter((k) => k.startsWith(p));
  return hits.length === 1 ? hits[0] : hits.length ? hits : null;
}
