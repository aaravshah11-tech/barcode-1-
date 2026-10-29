// AGENT DIAGNOSTICS (in the Agent window): battery graph, link time, uptime, dropouts.
import { esc } from '../shared/ui.js';
import { hoursLeft, fmtDuration } from '../shared/diag.js';
import { timeChart } from './charts.js';

const linkWord = (ms) => (ms == null ? '—' : ms < 80 ? 'Excellent' : ms < 200 ? 'Good' : ms < 500 ? 'Fair' : 'Poor');

/** Fill `box` with the Agent's diagnostics (fetched from HQ). */
export async function renderDiagnostics(box, a, api) {
  let d;
  try { d = await api(`/agents/${a.id}/diag`); } catch (x) { box.innerHTML = `<p class="small c-red">${esc(x.message)}</p>`; return; }
  const now = Date.now(), t0 = now - 24 * 3600000;
  const s = (d.samples || []).filter((x) => x.t >= t0);
  const st = d.status || {};
  // charging spans, for shading the battery chart
  const charging = [];
  for (let i = 0; i < s.length; i++) if (s[i].c) { const end = s[i + 1]?.t ?? now; const last = charging.at(-1); if (last && last[1] === s[i].t) last[1] = end; else charging.push([s[i].t, end]); }
  const left = hoursLeft(d.samples || []);
  const batt = typeof st.battery === 'number' ? Math.round(st.battery * 100) : s.filter((x) => x.b != null).at(-1)?.b ?? null;
  box.innerHTML = `<h2 style="margin-bottom:8px">Diagnostics</h2>
    <dl class="kv diag-kv">
      <dt>Link to HQ</dt><dd>${d.online ? `${st.rtt != null ? `${st.rtt} ms · ${linkWord(st.rtt)}` : 'measuring…'}` : `<span class="c-amber">offline</span> · last seen ${esc(new Date(d.lastSeen || 0).toLocaleString('en-GB'))}`}</dd>
      <dt>Connected for</dt><dd>${d.online && d.connectedAt ? fmtDuration(now - d.connectedAt) : '—'}</dd>
      <dt>Agent running for</dt><dd>${st.since ? fmtDuration(now - st.since) : '—'}</dd>
      <dt>Dropouts (24 h)</dt><dd>${d.offline24h}</dd>
      <dt>Battery</dt><dd>${batt != null ? `${batt}%${st.charging ? ' · charging' : left != null ? ` · about ${left} h left` : ''}` : 'not shared by this device'}</dd>
      <dt>Network</dt><dd>${st.net ? `${esc(st.net.toUpperCase())}${st.downlink ? ` · ~${st.downlink} Mbps` : ''}` : '—'}</dd>
    </dl>
    <div class="diag-charts">
      ${timeChart({ points: s.map((x) => [x.t, x.b]), t0, t1: now, max: 100, label: 'Battery · last 24 h', unit: '%', current: batt, threshold: 20, thresholdLabel: 'Low-battery alert (20%)', shade: charging, shadeLabel: 'Charging', empty: batt == null ? 'This device doesn’t share its battery level (iPhones don’t).' : 'The graph fills in over the next hour.' })}
      ${timeChart({ points: s.map((x) => [x.t, x.r]), t0, t1: now, max: Math.max(200, ...s.map((x) => x.r || 0)) * 1.1, label: 'Link time to HQ · last 24 h', unit: ' ms', current: st.rtt ?? null, empty: 'The graph fills in over the next hour.' })}
    </div>
    <p class="small muted">A web page can’t read Wi-Fi signal bars, so the link time is the signal measure: lower is better. HQ warns in the Mission Log when the battery drops below 20% (and again below 10%).</p>`;
}
