// MISSION BRIEFING: yesterday (or today so far) summed up. Opens by itself once each morning.
import { esc, sheet, toast } from '../shared/ui.js';

const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const KEY = 'sentinel.briefingSeen';
const today = () => new Date().toDateString();

export async function openBriefing(S, { daysAgo = 1 } = {}) {
  let b;
  try { b = await S.api(`/briefing?daysAgo=${daysAgo}`); } catch (x) { toast(x.message, { kind: 'err' }); return null; }
  const day = new Date(b.from).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const s = sheet(`<div class="briefing" data-briefingbody>
      <div class="brief-meta mono small"><span>${daysAgo ? 'Period: 24 h' : `Period: 00:00–${hm(b.to)}`}</span><span>Prepared ${hm(Date.now())}</span><span class="grow"></span>
        <span class="filters"><button data-bday="1" aria-pressed="${daysAgo === 1}">Yesterday</button><button data-bday="0" aria-pressed="${daysAgo === 0}">Today so far</button></span></div>
      <p class="brief-head">${esc(b.headline)}</p>
      ${b.empty ? '<p class="muted">Nothing was logged in this period.</p>' : `
      <div class="brief-stats">
        ${[['Sensor reports', b.counts.activity], ['Alerts', b.counts.alerts], ['Door events', b.counts.doors], ['Messages sent', b.counts.messages], ['Internet outages', b.counts.outages]]
          .map(([l, n]) => `<div class="stat"><b class="${l === 'Alerts' && n ? 'c-red' : ''}">${n}</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="brief-grid">
        <section><h3>Comings and goings</h3>
          ${b.departures.length || b.arrivals.length ? `<ul class="brief-list">${[...b.departures.map((t) => [t, 'Departed (AWAY)']), ...b.arrivals.map((t) => [t, 'Returned (HOME)'])].sort((x, y) => x[0] - y[0]).map(([t, w]) => `<li><span class="mono">${hm(t)}</span>${w}</li>`).join('')}</ul>` : '<p class="small muted">No AWAY / HOME changes.</p>'}
          ${b.first ? `<p class="small">First activity <b class="mono">${hm(b.first)}</b> · last <b class="mono">${hm(b.last)}</b>${b.busiestHour != null ? ` · busiest hour <b class="mono">${String(b.busiestHour).padStart(2, '0')}:00</b>` : ''}</p>` : ''}</section>
        <section><h3>Busiest rooms</h3>
          ${b.busiest.length ? `<ul class="brief-bars">${b.busiest.map((r) => `<li><span>${esc(r.name)}</span><span class="bar"><i style="width:${Math.round((r.count / b.busiest[0].count) * 100)}%"></i></span><b class="mono">${r.count}</b></li>`).join('')}</ul>` : '<p class="small muted">No sensor reports.</p>'}</section>
        <section><h3>Alerts</h3>
          ${b.alerts.length ? `<ul class="brief-list">${b.alerts.map((a) => `<li><span class="mono">${hm(a.ts)}</span>${esc(a.message)}</li>`).join('')}</ul>` : '<p class="small muted">None.</p>'}</section>
        <section><h3>Agent health</h3>
          ${b.health.length ? `<table class="brief-table"><thead><tr><th>Agent</th><th>Now</th><th>Dropouts</th><th>Lowest battery</th></tr></thead><tbody>
            ${b.health.map((h) => `<tr><td>${esc(h.label)} <b>${esc(h.codename)}</b></td><td>${h.online ? '<span class="c-green">Online</span>' : '<span class="c-amber">Offline</span>'}</td><td>${h.offline}</td><td>${h.minBattery != null ? `${h.minBattery}%${h.lowBattery ? ' <span class="c-amber">low</span>' : ''}` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">No Agents deployed.</p>'}</section>
      </div>`}
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button data-bspeak>Read aloud</button><button class="btn-primary" data-close>Acknowledged</button></div>
    </div>`, { title: `Mission briefing · ${day}`, wide: true, onClose: () => { try { speechSynthesis.cancel(); } catch { /* none */ } } });
  s.body.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (t?.dataset.bday) { s.close(); openBriefing(S, { daysAgo: Number(t.dataset.bday) }); }
    if (t && 'bspeak' in t.dataset) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(`Mission briefing for ${day}. ${b.summary}`);
        const v = speechSynthesis.getVoices().find((x) => x.localService && /^en/i.test(x.lang));
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      } catch { toast('This browser can’t read aloud.'); }
    }
  });
  try { localStorage.setItem(KEY, today()); } catch { /* private window */ }
  return b;
}

/** Once a day, from 5 am, open yesterday's briefing (if anything happened and it's switched on). */
export async function maybeAutoBriefing(S) {
  if (!S.settings.briefingAuto || new Date().getHours() < 5) return;
  try { if (localStorage.getItem(KEY) === today()) return; } catch { return; }
  let b;
  try { b = await S.api('/briefing?daysAgo=1'); } catch { return; }
  try { localStorage.setItem(KEY, today()); } catch { /* ignore */ }
  if (!b.empty && !document.querySelector('.sheet-backdrop')) openBriefing(S, { daysAgo: 1 });
}
