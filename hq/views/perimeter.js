// PERIMETER view: the three outside zones (front / driveway, garden, garage / shed), today's front-door visits,
// doors left open, and the weather station (Open-Meteo forecast, RainViewer rain radar, Met Office warnings link).
import { esc, $, toast, dayClock } from '../../shared/ui.js';
import { compass, RADAR_INDEX, tileOf, METOFFICE_WARNINGS } from '../../shared/weather.js';
import { sunTimes } from '../../shared/sun.js';
import { missionById } from '../../shared/missions.js';

const clock = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');
const short = (m) => String(m || '').replace(/^AGENT-\d+ [^:]+: /, '');
const COUNT_LABEL = [['person', 'People'], ['vehicle', 'Vehicles'], ['animal', 'Animals'], ['motion', 'Movement'], ['door', 'Door opened']];

/** ctx = { S, api } */
export function createPerimeter(ctx) {
  const { S } = ctx;
  let root = null, data = null, radar = { at: 0, frame: null, err: '' };

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad perimeter">
      <div class="per-grid">
        <section class="per-zones" data-pzones aria-label="Outside zones"></section>
        <section class="panel per-visits"><div class="row"><span class="lbl grow">Front door · today</span><span class="small muted" data-popen></span></div><ol class="visit-list" data-pvisits></ol></section>
        <section class="panel per-wx" data-pwx aria-label="Weather station"></section>
      </div>
      <form class="row small per-set" data-pset><label>Warn when the garage / shed door is open for <select name="garageOpenMin">${[5, 10, 15, 30, 60].map((m) => `<option value="${m}">${m} min</option>`).join('')}</select></label>
        <span class="muted">· Outside Agents can’t raise alerts until their privacy masks are confirmed on the Agent.</span></form></div>`;
    $('[data-pset]', root).addEventListener('change', async (e) => {
      try { S.settings = await ctx.api('/settings', { method: 'PATCH', body: { garageOpenMin: Number(e.target.value) } }); toast('Saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
    load();
  }
  async function load() {
    try { data = await ctx.api('/perimeter'); } catch (x) { toast(x.message, { kind: 'err' }); return; }
    draw();
  }
  function draw() {
    if (!root?.isConnected || !data) return;
    $('[name=garageOpenMin]', root).value = String(data.garageOpenMin);
    $('[data-pzones]', root).innerHTML = data.zones.map((z) => {
      const open = z.zone === 'garage' ? data.open : [];
      const state = !z.watchers.length ? ['off', 'NO AGENT'] : !z.online ? ['off', 'OFFLINE'] : z.unarmed.length ? ['warn', 'NOT ARMED'] : open.length ? ['warn', 'DOOR OPEN'] : z.last && Date.now() - z.last.ts < 15 * 60000 && z.last.level === 'alert' ? ['alert', 'ACTIVITY'] : ['on', 'CLEAR'];
      return `<article class="panel zone-card" data-pzone="${z.zone}">
        <header class="row"><span class="lbl grow">${esc(z.label)}</span><span class="zstate z-${state[0]}"><span class="dot ${state[0] === 'on' ? 'on' : state[0] === 'alert' ? 'alert' : state[0] === 'warn' ? 'warn' : ''}"></span>${state[1]}</span></header>
        <div class="zcounts">${COUNT_LABEL.map(([k, l]) => `<span><b class="mono">${z.counts[k]}</b>${l}</span>`).join('')}</div>
        <p class="small">${z.last ? `<span class="mono muted">${dayClock(z.last.ts)}</span> ${esc(short(z.last.message))}` : '<span class="muted">Nothing today.</span>'}</p>
        ${open.map((d) => `<p class="small c-amber">${esc(d.name)} open for ${d.mins} min (since ${clock(d.since)})</p>`).join('')}
        <p class="small muted">${z.watchers.length ? `Watched by ${z.watchers.map((w) => `${esc(w.codename)} (${esc(missionById(w.mission)?.name || w.mission)}${w.online ? '' : ', offline'})`).join(', ')}` : 'No Agent here. Put one on PERIMETER WATCH looking out of a window, or place one in this zone in the house builder.'}${z.unarmed.length ? ` · <span class="c-amber">${esc(z.unarmed.join(', '))}: finish the privacy-mask setup on the Agent</span>` : ''}</p>
      </article>`;
    }).join('');
    $('[data-popen]', root).textContent = data.visits.length ? `${data.visits.length} visit${data.visits.length === 1 ? '' : 's'}` : '';
    $('[data-pvisits]', root).innerHTML = data.visits.length ? data.visits.map((v) => `<li class="visit v-${v.lingering ? 'warn' : v.answered ? 'ok' : 'plain'}">
        <span class="mono">${clock(v.start)}</span><span><b>${esc(v.label)}</b><small>${v.mins ? `${v.mins} min · ` : ''}${esc(v.outcome)} · seen ${v.sightings}×</small></span></li>`).join('')
      : '<li class="muted small">No one seen at the front today. Visits appear here when a PERIMETER WATCH Agent watching the front recognises a person.</li>';
    drawWeather();
  }

  // ---------- weather station ----------
  function drawWeather() {
    const box = $('[data-pwx]', root);
    const w = S.weather, loc = S.settings?.location;
    if (!loc) { box.innerHTML = '<span class="lbl">Weather station</span><p class="small muted">Set your town first: <button class="link-btn" data-setloc>set location</button>. Only a rough position (about 1 km) is used.</p>'; return; }
    if (!w) { box.innerHTML = '<span class="lbl">Weather station</span><p class="small muted">Fetching the forecast…</p>'; return; }
    const sun = sunTimes(Date.now(), loc.lat, loc.lon);
    const hours = (w.hours || w.next || []).slice(0, 12);
    const maxT = Math.max(...hours.map((x) => x.temp ?? -99)), minT = Math.min(...hours.map((x) => x.temp ?? 99));
    box.innerHTML = `<div class="row"><span class="lbl grow">Weather station · ${esc(w.place || loc.name)}</span><span class="small muted mono">${w.stale ? 'OLD · ' : ''}${clock(w.at)}</span></div>
      <div class="wx-now"><span class="wx-temp mono">${Math.round(w.temp)}°</span><div><b>${esc(w.text)}</b><small>Feels ${Math.round(w.feels)}° · high ${w.high ?? '—'}° low ${w.low ?? '—'}°</small></div></div>
      <dl class="wx-kv mono">
        <dt>Wind</dt><dd>${w.wind} mph ${esc(compass(w.windDir))}${w.gust != null ? ` · gusts ${w.gust}` : ''}</dd>
        <dt>Rain</dt><dd>${w.rainIn === 0 ? 'now' : w.rainIn != null ? `in ~${w.rainIn} min` : 'none due'}${w.rainToday != null ? ` · ${w.rainToday} mm today` : ''}</dd>
        <dt>Humidity</dt><dd>${w.humidity != null ? `${w.humidity}%` : '—'}</dd>
        <dt>Sun</dt><dd>${sun.polar ? (sun.polar === 'day' ? 'up all day' : 'down all day') : `↑ ${clock(sun.sunrise)} · ↓ ${clock(sun.sunset)}`}</dd>
      </dl>
      ${hours.length ? `<div class="wx-hours" aria-label="Next 12 hours">${hours.map((x) => `<div title="${clock(x.t)}: ${x.temp ?? '—'}°, rain ${x.prob ?? 0}%"><i style="height:${Math.max(4, x.prob ?? 0)}%"></i><b class="mono">${x.temp != null ? Math.round(x.temp) : ''}°</b><small class="mono">${new Date(x.t).getHours()}</small></div>`).join('')}</div><p class="small muted">Bars: chance of rain each hour.${maxT > -99 ? ` ${Math.round(minT)}°–${Math.round(maxT)}° over the next 12 h.` : ''}</p>` : ''}
      ${w.wind >= 25 || (w.gust ?? 0) >= 40 ? '<p class="small c-amber">Windy: outside movement is graded down (branches, bins, washing).</p>' : ''}
      <div class="radar" data-radar><span class="small muted">Loading rain radar…</span></div>
      <p class="small muted">Radar: <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a> · map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>. UK weather warnings: <a href="${METOFFICE_WARNINGS}" target="_blank" rel="noopener">Met Office</a> (their feed can’t be read from a web page, so this is a link).</p>`;
    drawRadar(loc);
  }
  async function drawRadar(loc) {
    const box = $('[data-radar]', root);
    if (!box) return;
    if (Date.now() - radar.at > 10 * 60000) {
      radar.at = Date.now();
      try {
        const r = await fetch(RADAR_INDEX, { cache: 'no-store' });
        const j = await r.json();
        const f = j.radar?.past?.at(-1);
        radar.frame = f ? { host: j.host, path: f.path, time: f.time * 1000 } : null;
        radar.err = f ? '' : 'no radar frames';
      } catch (e) { radar.frame = null; radar.err = e.message; }
    }
    if (!box.isConnected) return;
    if (!radar.frame) { box.innerHTML = `<span class="small muted">Rain radar unavailable right now${radar.err ? ` (${esc(radar.err)})` : ''}.</span>`; return; }
    const z = 7, t = tileOf(loc.lat, loc.lon, z), cells = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push([t.x + dx, t.y + dy]);
    // where the house is inside the middle tile
    const n = 2 ** z, fx = (((loc.lon + 180) / 360) * n) - t.x, r = (loc.lat * Math.PI) / 180, fy = (((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) - t.y;
    box.innerHTML = `<div class="radar-grid">${cells.map(([x, y]) => `<div><img alt="" loading="lazy" src="https://tile.openstreetmap.org/${z}/${x}/${y}.png"><img alt="" loading="lazy" class="rain" src="${radar.frame.host}${radar.frame.path}/256/${z}/${x}/${y}/2/1_1.png"></div>`).join('')}
      <span class="radar-pin" style="left:${((1 + fx) / 3) * 100}%;top:${((1 + fy) / 3) * 100}%" title="Home (roughly)"></span></div>
      <span class="small muted mono">Radar ${clock(radar.frame.time)}</span>`;
  }
  return { render, refresh() { if (root?.isConnected) load(); }, weather() { if (root?.isConnected) drawWeather(); } };
}
