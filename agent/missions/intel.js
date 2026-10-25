// INTEL SCREEN: a view-only wall display of the Command Centre (radar, threat level, Mission Log, who's home).
import { esc, dayClock } from '../../shared/ui.js';
import { Radar } from '../../shared/radar.js';

const KINDS = new Set(['motion', 'door', 'sound', 'light', 'knock']);

export function start(ctx) {
  let s = ctx.settings;
  ctx.keepBright(true);
  document.body.classList.add('intel-mode');
  ctx.root.innerHTML = `
    <div class="intel">
      <div class="intel-threat" data-threat></div>
      <div class="intel-grid">
        <div class="intel-radar"><canvas data-radar role="img"></canvas></div>
        <div class="intel-side">
          <div class="people" data-people></div>
          <ol class="intel-log" data-log></ol>
        </div>
      </div>
    </div>`;
  const $ = (q) => ctx.root.querySelector(q);
  const radar = new Radar($('[data-radar]'), { fx: ctx.fx() });
  let st = ctx.lastState() || { agents: [], events: [], people: [], threat: null };
  let queued = false;
  const render = () => {
    queued = false;
    const t = st.threat || { level: 'GREEN', reason: 'Waiting for HQ…' };
    $('[data-threat]').className = `intel-threat threat ${t.level}`;
    $('[data-threat]').textContent = `THREAT ${t.level} — ${t.reason}`;
    const now = Date.now();
    radar.setAgents(st.agents.map((a) => ({ ...a, warn: st.events.some((e) => e.agentId === a.id && KINDS.has(e.kind) && now - e.ts < 60000) })));
    const away = st.settings?.mode === 'away';
    $('[data-people]').innerHTML = `<span class="person"><span class="dot ${away ? 'warn' : 'on'}"></span>${away ? 'AWAY — nobody’s home' : 'HOME'}</span>`;
    $('[data-log]').hidden = !s.showLog;
    if (s.showLog) $('[data-log]').innerHTML = st.events.slice(0, 14).map((e) => `<li class="${esc(e.level)}"><time>${esc(dayClock(e.ts))}</time> ${esc(e.message)}</li>`).join('');
  };
  const later = () => { if (!queued) { queued = true; setTimeout(render, 250); } };
  render();
  return {
    update(next) { s = next; render(); },
    onHq(msg) {
      if (msg.t === 'state') st = msg;
      else if (msg.t === 'agent') { const i = st.agents.findIndex((a) => a.id === msg.agent.id); if (i >= 0) st.agents[i] = msg.agent; else st.agents.push(msg.agent); }
      else if (msg.t === 'agentRemoved') st.agents = st.agents.filter((a) => a.id !== msg.id);
      else if (msg.t === 'event') { st.events.unshift(msg.event); st.events.length = Math.min(st.events.length, 100); if (msg.event.agentId && KINDS.has(msg.event.kind)) radar.pulse(msg.event.agentId, 'warn'); }
      else if (msg.t === 'threat') st.threat = msg.threat;
      else if (msg.t === 'settings') st.settings = msg.settings;
      else return;
      later();
    },
    stop() { radar.destroy(); ctx.keepBright(false); document.body.classList.remove('intel-mode'); },
  };
}
