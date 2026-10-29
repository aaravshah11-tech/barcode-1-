// SECURE TERMINAL: type commands instead of clicking (press ` to open, Esc to close).
// Voice commands go through the same place, so typing and talking always do the same thing.
import { esc, $, confirmBox, clock } from '../shared/ui.js';
import { parseCommand, complete, COMMANDS } from '../shared/command.js';
import { MODE_INFO, ACTIVITY_KINDS } from '../shared/threat.js';
import { fmtDuration } from '../shared/diag.js';
import { rainLine } from './intel.js';
import { icon } from '../shared/icons.js';
import { sfx } from '../shared/sfx.js';

/**
 * env = { S, api, lock(), setMapView(view), flyTo(agentId), openLive(agent), onSettings(settings) }
 * Returns { open, close, toggle, run(text, { voice }) → Promise<{ ok, reply }> }.
 */
const waitFor = (fn, ms = 20000) => new Promise((res) => { const t0 = Date.now(); const tick = () => (fn() || Date.now() - t0 > ms ? res() : setTimeout(tick, 250)); tick(); });

export function createTerminal(env) {
  const { S } = env;
  const lines = []; // what the terminal shows (kept while the page is open)
  const history = [];
  let hpos = 0, el = null;

  const ctx = () => ({
    agents: S.agents,
    rooms: (S.house?.floors || []).flatMap((f) => f.rooms.map((r) => ({ id: r.id, name: r.name }))),
  });
  const roomName = (a) => { for (const f of S.house?.floors || []) { const r = f.rooms.find((x) => x.id === a.place?.roomId); if (r) return r.name; } return ''; };
  const out = (text, cls = '') => { lines.push({ text, cls }); while (lines.length > 400) lines.shift(); paint(); };

  async function exec(c) {
    const ok = (reply, extra = []) => ({ ok: true, reply, lines: extra });
    const no = (reply) => ({ ok: false, reply });
    switch (c.cmd) {
      case 'none': return ok('');
      case 'help': return ok('Commands:', COMMANDS.map(([, use, what]) => `  ${use.padEnd(34)} ${what}`).concat(['', 'Voice: hold the microphone button (or the V key) and say a command, e.g. “switch to night mode”.']));
      case 'status': {
        const t = S.threat || { level: 'GREEN', reason: '' }, on = S.agents.filter((a) => a.online).length;
        return ok(`Threat level ${t.level}. ${MODE_INFO[S.settings.mode || 'home'].label} mode. ${on} of ${S.agents.length} Agent${S.agents.length === 1 ? '' : 's'} online.`, [`  ${t.reason || ''}`]);
      }
      case 'agents':
        if (!S.agents.length) return ok('No Agents deployed. Use Recruit to add an old phone.');
        return ok(`${S.agents.length} Agent${S.agents.length === 1 ? '' : 's'}:`, S.agents.map((a) => `  ${a.label.padEnd(9)} ${a.codename.padEnd(12)} ${(a.online ? 'ONLINE' : 'OFFLINE').padEnd(8)} ${[a.name, roomName(a)].filter(Boolean).join(' · ')}`));
      case 'find': {
        const a = S.agents.find((x) => x.id === c.agentId);
        await env.api(`/agents/${a.id}/command`, { method: 'POST', body: { action: 'find' } }).catch((x) => { throw x.status === 409 ? new Error(`${a.codename} is offline.`) : x; });
        env.flyTo(a.id);
        return ok(`${a.codename} is flashing its codename.`);
      }
      case 'send': {
        const r = await env.api('/comms', { method: 'POST', body: { target: c.target, text: c.text, speak: true } });
        return ok(`Transmitted to ${r.delivered} Agent${r.delivered === 1 ? '' : 's'}${r.queued ? `; ${r.queued} offline, delivered when they reconnect` : ''}.`);
      }
      case 'log': {
        const evs = S.events.filter((e) => !c.alerts || e.level !== 'info').slice(0, c.n);
        if (!evs.length) return ok(c.alerts ? 'No alerts.' : 'The Mission Log is empty.');
        return ok(`${c.alerts ? 'Latest alerts' : 'Mission Log'} (${evs.length}):`, evs.map((e) => `  ${clock(e.ts)}  ${(e.level === 'info' ? '' : e.level.toUpperCase()).padEnd(6)} ${e.message}`));
      }
      case 'whereis': {
        const since = Date.now() - 30 * 60000, seen = new Map();
        for (const e of S.events) { if (e.ts < since) break; if (!ACTIVITY_KINDS.has(e.kind)) continue; const a = S.agents.find((x) => x.id === e.agentId); const where = a ? roomName(a) || a.name || a.codename : '?'; if (!seen.has(where)) seen.set(where, e.ts); }
        if (!seen.size) return ok(`No movement reported in the last 30 minutes. Mode: ${MODE_INFO[S.settings.mode || 'home'].label}.`);
        const list = [...seen].map(([w, ts]) => `${w} ${Math.max(1, Math.round((Date.now() - ts) / 60000))} min ago`);
        return ok(`Activity in the last 30 minutes: ${list.join(', ')}.`);
      }
      case 'briefing': {
        const b = await env.api(`/briefing?daysAgo=${c.daysAgo}`);
        const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const extra = b.empty ? [] : [
          `  Sensor reports ${b.counts.activity} · alerts ${b.counts.alerts} · doors ${b.counts.doors} · outages ${b.counts.outages}`,
          ...(b.busiest.length ? [`  Busiest: ${b.busiest.map((r) => `${r.name} (${r.count})`).join(', ')}`] : []),
          ...(b.departures.length || b.arrivals.length ? [`  Departures ${b.departures.map(hm).join(' ') || '—'} · arrivals ${b.arrivals.map(hm).join(' ') || '—'}`] : []),
          ...b.health.filter((h) => !h.ok).map((h) => `  ${h.label} ${h.codename}: ${h.offline} dropout${h.offline === 1 ? '' : 's'}${h.lowBattery ? ', low battery' : ''}`),
          '  Full briefing: the Mission briefing button in the Situation panel.',
        ];
        return ok(`${c.daysAgo ? 'Yesterday' : 'Today so far'}: ${b.summary}`, extra);
      }
      case 'weather': {
        const w = S.weather;
        if (!S.settings.location) return no('No location set. Settings › General › Location.');
        if (!w) return no('No forecast yet. Check HQ’s internet connection.');
        return ok(`${w.temp} degrees and ${w.text.toLowerCase()} in ${S.settings.location.name}. ${rainLine(w)}.`, [`  Feels ${w.feels}° · wind ${w.wind} mph${w.high != null ? ` · high ${w.high}° low ${w.low}°` : ''}`]);
      }
      case 'diag': {
        const list = c.agentId ? S.agents.filter((a) => a.id === c.agentId) : S.agents;
        if (!list.length) return ok('No Agents deployed.');
        const row = (a) => { const st = a.status || {}; return `  ${a.label.padEnd(9)} ${a.codename.padEnd(12)} ${(a.online ? 'ONLINE' : 'OFFLINE').padEnd(8)} battery ${typeof st.battery === 'number' ? `${Math.round(st.battery * 100)}%${st.charging ? '+' : ''}` : 'n/a'} · link ${st.rtt != null ? `${st.rtt} ms` : '—'} · on duty ${st.since ? fmtDuration(Date.now() - st.since) : '—'}`; };
        const low = list.filter((a) => typeof a.status?.battery === 'number' && a.status.battery < 0.2 && !a.status.charging);
        const off = list.filter((a) => !a.online);
        return ok(low.length || off.length ? `${[low.length ? `${low.length} low on battery` : '', off.length ? `${off.length} offline` : ''].filter(Boolean).join(', ')}.` : `${list.length === 1 ? `${list[0].codename} is` : `All ${list.length} Agents are`} healthy.`, list.map(row));
      }
      case 'replay': {
        if (c.stop) { env.stopReplay(); return ok('Replay stopped. Back to live.'); }
        const started = await env.replay(c.daysAgo);
        return started ? ok(`Replaying ${c.daysAgo ? 'yesterday' : 'today'} on the map. Use the bar under the map to pause, change speed or jump.`) : no('Replay needs a floor plan with Agents placed on it.');
      }
      case 'heatmap': {
        await env.heat(c.on, c.days);
        if (!c.on) return ok('Heatmap off.');
        if (!S.heat.on) return no('The heatmap needs a floor plan with Agents placed on it.');
        const top = Object.entries(S.heat.counts).sort((a, b) => b[1] - a[1])[0];
        const name = top && (S.house?.floors || []).flatMap((f) => f.rooms).find((r) => r.id === top[0])?.name;
        return ok(`Heatmap on (${c.days === 7 ? 'last 7 days' : 'today'}).${name ? ` Busiest: ${name}, ${top[1]} events.` : ' No sensor events in rooms yet.'}`);
      }
      case 'global': {
        setTimeout(close, 0);
        const at = await env.global(c.sel || null);
        if (!at) return no('Global intel couldn’t open.');
        if (c.say === 'iss') { await waitFor(() => at.state.iss || at.state.status.iss === 'offline'); const s = at.state; if (!s.iss) return no(`No orbit data (${s.err.iss || 'offline'}).`); const p = s.passes[0]; return ok(`The ISS is ${s.iss.altKm} km up${p ? `. Next pass over HQ ${new Date(p.start).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}, up to ${p.maxEl} degrees` : ''}.`); }
        if (c.say === 'air') { await waitFor(() => ['live', 'offline', 'off'].includes(at.state.status.air)); const s = at.state; if (s.status.air === 'off') return no('Set your location first: Settings › General.'); if (s.status.air !== 'live') return no(`Aircraft feed offline (${s.err.air}).`); const n = s.aircraft.filter((a) => a.km <= s.range); return ok(n.length ? `${n.length} aircraft within ${s.range} km. Nearest: ${n[0].callsign}, ${n[0].km} km away.` : `No aircraft within ${s.range} km right now.`); }
        if (c.say === 'quakes') { await waitFor(() => at.state.status.quakes !== 'loading'); const q = at.state.quakes; if (!q.length) return ok('No earthquakes above magnitude 2.5 reported in the last 24 hours.'); const big = [...q].sort((a, b) => b.mag - a.mag)[0]; at.select({ type: 'quake', id: big.id }); return ok(`${q.length} earthquakes in the last 24 hours. Strongest: magnitude ${big.mag.toFixed(1)}, ${big.place}.`); }
        if (c.say === 'ship') return ok(`Ship ${c.sel.id} selected. Use “Open live position in Argos Atlas” on the card.`);
        return ok('Global intel open. Esc closes it.');
      }
      case 'net': {
        const n = S.net;
        if (!n || n.online == null) return ok('No internet checks yet.');
        return ok(n.online ? `Internet up. ${n.latency} ms response.${n.uptime24h != null ? ` ${n.uptime24h}% uptime in 24 hours.` : ''}` : 'Internet DOWN.', (n.speed || []).slice(-1).map((s) => `  Last speed test: ${s.down} Mbps down${s.up != null ? ` · ${s.up} Mbps up` : ''}`));
      }
      case 'speedtest': {
        out('Running speed test (about 20 seconds)…', 'muted');
        const r = await env.api('/net/speedtest', { method: 'POST' });
        return ok(`${r.down} megabits down${r.up != null ? `, ${r.up} up` : ''}.`);
      }
      case 'standdown': await env.api('/alarm/stop', { method: 'POST' }); return ok('Alarm stood down on all Agents.');
      case 'panic':
        if (!(await confirmBox('Raise PANIC?', 'HQ goes into LOCKDOWN and every Agent is alerted at once.', { ok: 'Raise panic', danger: true }))) return no('Panic cancelled.');
        env.onSettings(await env.api('/panic', { method: 'POST' }));
        return ok('PANIC raised. Lockdown in force.');
      case 'mode': {
        if (c.mode === S.settings.mode) return ok(`Already in ${MODE_INFO[c.mode].label} mode.`);
        if (c.mode === 'lockdown' && !(await confirmBox('Enter LOCKDOWN?', 'Every Agent is armed. Any activity is an intrusion and Agents may sound the alarm.', { ok: 'Lockdown', danger: true }))) return no('Lockdown cancelled.');
        env.onSettings(await env.api('/settings', { method: 'PATCH', body: { mode: c.mode } }));
        return ok(`${MODE_INFO[c.mode].label} mode. ${MODE_INFO[c.mode].summary}`);
      }
      case 'map': env.setMapView(c.view); return ok(`Map: ${c.view === '3d' ? '3D' : c.view}.`);
      case 'live': {
        const a = S.agents.find((x) => x.id === c.agentId);
        if (!a.online) return no(`${a.codename} is offline.`);
        env.openLive(a);
        return ok(`Opening live view on ${a.codename}. It shows a red banner while you watch.`);
      }
      case 'theme': env.onSettings(await env.api('/settings', { method: 'PATCH', body: { theme: c.theme } })); return ok(`Theme: ${c.theme}.`);
      case 'time': { const d = new Date(); return ok(`${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.`); }
      case 'whoami': return ok(`${S.operator || 'Director'} on ${S.mode === 'hq' ? 'the HQ computer' : 'a linked phone'}.`);
      case 'lock': setTimeout(() => env.lock(), 300); return ok('Locking.');
      case 'clear': lines.length = 0; paint(); return ok('');
      case 'error': return no(c.error);
      default: return no(`Unknown command “${c.text}”. Type help.`);
    }
  }

  /** Run one command (typed or spoken). */
  async function run(text, { voice = false } = {}) {
    const c = parseCommand(text, ctx());
    if (c.cmd !== 'none') out(`${voice ? 'voice>' : '>'} ${text}`, 'cmd');
    let r;
    try { r = await exec(c); } catch (x) { r = { ok: false, reply: x.message || 'That didn’t work.' }; }
    if (r.reply) out(r.reply, r.ok ? '' : 'err');
    for (const l of r.lines || []) out(l, 'muted');
    if (c.cmd !== 'none' && c.cmd !== 'clear') sfx(r.ok ? 'blip' : 'warn');
    return { ok: r.ok, reply: r.reply, cmd: c.cmd };
  }

  function paint() {
    const o = el && $('[data-termout]', el);
    if (!o) return;
    o.innerHTML = lines.map((l) => `<li class="${l.cls}">${esc(l.text) || '&nbsp;'}</li>`).join('');
    o.scrollTop = o.scrollHeight;
  }

  function open() {
    if (el) { $('[data-termin]', el).focus(); return; }
    el = document.createElement('section');
    el.className = 'term';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Secure terminal');
    el.innerHTML = `<header class="term-head">${icon('terminal')}<b>Secure terminal</b><span class="muted small">help · ↑ history · Tab completes · Esc closes</span><span class="spacer"></span><button class="icon-btn btn-ghost" data-termclose aria-label="Close terminal">${icon('close')}</button></header>
      <ol class="term-out" data-termout aria-live="polite"></ol>
      <form class="term-in" data-termform><label for="term-in" class="mono">SENTINEL&gt;</label><input id="term-in" data-termin autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"></form>`;
    document.body.appendChild(el);
    if (!lines.length) out('SENTINEL secure terminal. Type help for the commands.', 'muted');
    paint();
    const input = $('[data-termin]', el);
    $('[data-termform]', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      if (v.trim()) { history.push(v); if (history.length > 50) history.shift(); }
      hpos = history.length;
      await run(v);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); hpos = Math.max(0, hpos - 1); input.value = history[hpos]; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); hpos = Math.min(history.length, hpos + 1); input.value = history[hpos] || ''; }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const c = complete(input.value);
        if (typeof c === 'string') input.value = `${c} `;
        else if (Array.isArray(c)) out(c.join('   '), 'muted');
      } else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    $('[data-termclose]', el).addEventListener('click', close);
    input.focus();
  }
  function close() { el?.remove(); el = null; }
  const toggle = () => (el ? close() : open());
  return { open, close, toggle, run, get isOpen() { return !!el; }, lines };
}
