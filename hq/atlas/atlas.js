// GLOBAL INTEL: a live-tracking atlas. Globe in the middle (ISS, earthquakes, day/night), layers on the
// left, the selected item and the local AIRSPACE radar on the right, the INTEL WIRE ticker along the bottom.
// Each item has its own link (#iss, #flight=BAW12, #quake=…, #ship=235052123), like a live ship map.
// The feeds are asked for directly by this browser while the screen is open; nothing is stored at HQ
// except your ship watch list.
import { esc, $, $$, toast } from '../../shared/ui.js';
import { icon } from '../../shared/icons.js';
import { bboxAround, distanceKm, bearing, compass } from '../../shared/geo.js';
import { parseOpenSky, parseAdsbLol, nearby, flightLevel, parseQuakes, parseNews, validMmsi, mmsiCountry, argosLink, marineTrafficLink, cleanShips, parseHash, makeHash } from '../../shared/feeds.js';
import { parseTle, satrecOf, issAt, groundTrack, nextPasses, tleAgeDays } from '../../shared/iss.js';

export const SOURCES = {
  tle: ['https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', 'https://api.wheretheiss.at/v1/satellites/25544/tles'],
  opensky: (b) => `https://opensky-network.org/api/states/all?lamin=${b.lamin.toFixed(2)}&lomin=${b.lomin.toFixed(2)}&lamax=${b.lamax.toFixed(2)}&lomax=${b.lomax.toFixed(2)}`,
  adsblol: (h, km) => `https://api.adsb.lol/v2/point/${h.lat.toFixed(2)}/${h.lon.toFixed(2)}/${Math.ceil(km / 1.852)}`,
  quakes: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  news: `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query: 'sourcelang:english (sourcecountry:UK OR sourcecountry:US) (security OR intelligence OR breaking OR world)', mode: 'artlist', format: 'json', maxrecords: '40', sort: 'datedesc', timespan: '12h' })}`,
};
const EVERY = { iss: 2000, track: 60000, air: 60000, quakes: 600000, news: 900000, tle: 12 * 3600000 };
const LAYERS = [['iss', 'Space Station'], ['air', 'Aircraft'], ['quakes', 'Earthquakes · 24 h'], ['ships', 'Ship watch'], ['night', 'Day / night']];
const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

async function getJson(url, ms = 15000) {
  const ctl = new AbortController(), kill = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (r.status === 429) throw new Error('too many requests — will try again later');
    if (!r.ok) throw new Error(`said ${r.status}`);
    const type = r.headers.get('content-type') || '';
    return type.includes('json') ? r.json() : r.text();
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : e.message === 'Failed to fetch' ? 'not reachable' : e.message); } finally { clearTimeout(kill); }
}

let open = null;
/** Open the Global Intel screen. `S` = dashboard state. `initial` = a selection like { type: 'iss' }. */
export async function openAtlas(S, { initial = null } = {}) {
  if (open) { if (initial) open.select(initial); return open; }
  const home = S.settings.location ? { lat: S.settings.location.lat, lon: S.settings.location.lon, name: S.settings.location.name } : null;
  const st = {
    layers: { iss: true, air: true, quakes: true, ships: true, night: true },
    tle: null, satrec: null, iss: null, passes: [], aircraft: [], quakes: [], news: [],
    status: { iss: 'loading', air: home ? 'loading' : 'off', quakes: 'loading', news: 'loading' },
    err: {}, at: {}, sel: null, ships: cleanShips(S.settings.ships), range: S.settings.airspaceKm || 40,
  };
  const timers = [];
  const el = document.createElement('div');
  el.className = 'atlas';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Global intel');
  el.innerHTML = `
    <header class="at-top">
      <b class="at-title">${icon('globe')}Global intel</b>
      <span class="mono small at-utc" data-utc></span>
      <form class="at-search" data-atsearch role="search"><input name="q" placeholder="Search: ISS, callsign, MMSI, place…" autocomplete="off" aria-label="Search"><div class="at-results" data-atresults hidden></div></form>
      <span class="grow"></span>
      <button class="icon-btn" data-atclose aria-label="Close global intel" title="Close (Esc)">${icon('close')}</button>
    </header>
    <aside class="at-left">
      <h3>Layers</h3>
      <ul class="at-layers" data-layers></ul>
      <h3>Ship watch</h3>
      <ul class="at-ships" data-ships></ul>
      <form class="at-addship" data-addship><input name="mmsi" inputmode="numeric" placeholder="MMSI (9 digits)" maxlength="9" aria-label="Ship MMSI number"><input name="name" placeholder="Name (optional)" maxlength="40" aria-label="Ship name"><button>${icon('plus')}Add</button></form>
      <p class="small muted at-note">Ships: live positions open in <b>Argos Atlas</b>. Aircraft come from OpenSky Network (or adsb.lol) for your rough area only. Earthquakes: USGS. Headlines: GDELT. ISS: worked out on this device from its published orbit.</p>
    </aside>
    <main class="at-globe" data-globebox><div class="at-hint small mono">Drag to turn · scroll to zoom · click a marker</div>
      <div class="at-legend small"><span><i class="q-low"></i>M2.5+</span><span><i class="q-mid"></i>M4.5+</span><span><i class="q-high"></i>M6+</span><span><i class="q-iss"></i>ISS + orbit</span></div></main>
    <aside class="at-right">
      <section class="at-card" data-card aria-live="polite"></section>
      <section class="at-air"><div class="at-air-head"><h3>Airspace</h3><span class="filters" role="group" aria-label="Range">${[10, 25, 40, 80].map((k) => `<button data-range="${k}" aria-pressed="${k === st.range}">${k} km</button>`).join('')}</span></div>
        <div data-radar></div><ol class="at-flights mono small" data-flights></ol></section>
    </aside>
    <footer class="at-wire"><b class="at-wire-tag mono">Intel wire</b><div class="at-wire-track"><div class="at-wire-run mono" data-wire></div></div></footer>`;
  document.body.appendChild(el);
  document.body.classList.add('atlas-open');

  // ---------- the globe (WebGL) ----------
  let globe = null;
  try {
    const [{ Globe }, world] = await Promise.all([import('./globe.js'), fetch(new URL('../../vendor/world/countries-110m.json', import.meta.url)).then((r) => r.json()).catch(() => null)]);
    let low = false; try { low = localStorage.getItem('sentinel.q3d') === 'low'; } catch { /* default */ }
    globe = new Globe($('[data-globebox]', el), { world, home, lowPower: low, onPick: (p) => api.select(p.type === 'iss' ? { type: 'iss' } : { type: p.type, id: p.id }) });
  } catch (e) {
    console.warn(e);
    $('[data-globebox]', el).insertAdjacentHTML('beforeend', '<p class="at-noglobe muted">This computer can’t draw the 3D globe. Everything else still works.</p>');
  }

  // ---------- rendering ----------
  function renderLayers() {
    const n = { iss: st.iss ? 1 : 0, air: st.aircraft.length, quakes: st.quakes.length, ships: st.ships.length, night: null };
    const stat = (k) => { const s = st.status[k]; if (!s) return ''; return s === 'live' ? `<span class="st live">Live · ${hm(st.at[k])}</span>` : s === 'loading' ? '<span class="st">Loading…</span>' : s === 'off' ? '<span class="st">Set your location</span>' : `<span class="st bad" title="${esc(st.err[k] || '')}">Offline</span>`; };
    $('[data-layers]', el).innerHTML = LAYERS.map(([k, label]) => `<li><button data-layer="${k}" aria-pressed="${st.layers[k]}"><i class="lk lk-${k}"></i><span class="grow">${label}</span>${n[k] != null ? `<b class="mono">${n[k]}</b>` : ''}</button>${stat(k === 'iss' ? 'iss' : k === 'air' ? 'air' : k === 'quakes' ? 'quakes' : '')}</li>`).join('');
  }
  function renderShips() {
    $('[data-ships]', el).innerHTML = st.ships.length ? st.ships.map((s) => `<li><button data-ship="${s.mmsi}" aria-pressed="${st.sel?.type === 'ship' && st.sel.id === s.mmsi}">${icon('ship')}<span class="grow">${esc(s.name || `MMSI ${s.mmsi}`)}<small class="mono muted">${s.mmsi}${mmsiCountry(s.mmsi) ? ` · ${esc(mmsiCountry(s.mmsi))}` : ''}</small></span></button></li>`).join('') : '<li class="small muted">No ships yet. Add one by its 9-digit MMSI number.</li>';
  }
  function renderCard() {
    const c = $('[data-card]', el), sel = st.sel;
    if (!sel) { c.innerHTML = `<p class="muted small">Select something on the globe, the radar or the lists, or search above.</p>${st.passes[0] && home ? `<div class="at-kv"><span>Next ISS pass</span><b>${day(st.passes[0].start)} ${hm(st.passes[0].start)}</b></div>` : ''}`; return; }
    const kv = (rows) => `<dl class="at-kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const links = (ls) => `<div class="at-links">${ls.map(([l, u, primary]) => `<a class="btn ${primary ? 'btn-primary' : ''}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a>`).join('')}</div>`;
    if (sel.type === 'iss') {
      const p = st.iss, age = st.satrec ? tleAgeDays(st.satrec, Date.now()) : null;
      c.innerHTML = `<div class="at-card-head"><i class="lk lk-iss"></i><div><b>ISS (ZARYA)</b><small class="muted">International Space Station · NORAD 25544</small></div></div>
        ${p ? kv([['Position', ll(p.lat, p.lon)], ['Altitude', `${p.altKm} km`], ['Speed', `${p.speedKmh.toLocaleString('en-GB')} km/h`], home ? ['Distance', `${Math.round(distanceKm(home, p)).toLocaleString('en-GB')} km from HQ`] : null]) : `<p class="small c-red">${esc(st.err.iss || 'Orbit data not loaded.')}</p>`}
        ${home ? `<h4>Next passes over ${esc(home.name)}</h4>${st.passes.length ? `<ol class="at-passes">${st.passes.slice(0, 4).map((x) => `<li><b class="mono">${day(x.start)} ${hm(x.start)}</b><span>rises ${compass(x.startAz)} · highest ${x.maxEl}° · sets ${compass(x.endAz)} · ${Math.round((x.end - x.start) / 60000)} min</span></li>`).join('')}</ol><p class="small muted">Look for a bright, steady star moving fast. It’s only visible when your sky is dark and the ISS is still in sunlight (often just after dusk or before dawn).</p>` : '<p class="small muted">No high passes in the next 2 days.</p>'}` : '<p class="small muted">Set your location (Settings › General) for passes over your house.</p>'}
        ${age != null && age > 3 ? `<p class="small c-amber">Orbit data is ${Math.round(age)} days old — positions are approximate.</p>` : ''}
        <div class="row"><button class="small" data-follow aria-pressed="${globe?.follow === 'iss'}">${globe?.follow === 'iss' ? 'Following' : 'Follow'}</button></div>
        ${links([['NASA: Spot the Station', 'https://spotthestation.nasa.gov/'], ['Where is the ISS?', 'https://wheretheiss.at/']])}`;
    } else if (sel.type === 'flight') {
      const a = st.aircraft.find((x) => x.id === sel.id || x.callsign === sel.id);
      if (!a) { c.innerHTML = `<div class="at-card-head"><i class="lk lk-air"></i><div><b>${esc(sel.id)}</b><small class="muted">Not in your airspace right now</small></div></div>${links([['Look it up on Flightradar24', `https://www.flightradar24.com/${encodeURIComponent(sel.id)}`]])}`; return; }
      c.innerHTML = `<div class="at-card-head"><i class="lk lk-air"></i><div><b>${esc(a.callsign)}</b><small class="muted">${esc([a.type, a.reg, a.country].filter(Boolean).join(' · ') || `ICAO ${a.id.toUpperCase()}`)}</small></div></div>
        ${kv([['Altitude', a.onGround ? 'On the ground' : flightLevel(a.altFt)], ['Speed', a.speedKt != null ? `${a.speedKt} kt` : '—'], ['Heading', a.heading != null ? `${Math.round(a.heading)}° ${compass(a.heading)}` : '—'], a.climb ? ['Climb', `${a.climb > 0 ? '+' : ''}${a.climb} ft/min`] : null, ['From HQ', `${a.km} km ${compass(a.brg)}`], ['Position', ll(a.lat, a.lon)], ['Source', esc(a.src)]])}
        ${links([['Flightradar24', `https://www.flightradar24.com/${encodeURIComponent(a.callsign)}`, true], ['ADS-B Exchange', `https://globe.adsbexchange.com/?icao=${encodeURIComponent(a.id)}`]])}`;
    } else if (sel.type === 'quake') {
      const q = st.quakes.find((x) => x.id === sel.id);
      if (!q) { c.innerHTML = '<p class="muted small">That earthquake isn’t in the last 24 hours’ list.</p>'; return; }
      c.innerHTML = `<div class="at-card-head"><i class="lk lk-quakes ${q.mag >= 6 ? 'high' : q.mag >= 4.5 ? 'mid' : ''}"></i><div><b>M${q.mag.toFixed(1)} earthquake</b><small class="muted">${esc(q.place)}</small></div></div>
        ${kv([['Time', `${hm(q.time)} (${ago(q.time)})`], ['Depth', `${q.depth} km`], ['Position', ll(q.lat, q.lon)], home ? ['From HQ', `${Math.round(distanceKm(home, q)).toLocaleString('en-GB')} km ${compass(bearing(home, q))}`] : null, q.tsunami ? ['Tsunami', '<span class="c-red">Tsunami information issued</span>'] : null])}
        ${q.url ? links([['USGS event page', q.url, true]]) : ''}`;
    } else if (sel.type === 'ship') {
      const s = st.ships.find((x) => x.mmsi === sel.id) || { mmsi: sel.id, name: '' };
      const watched = st.ships.some((x) => x.mmsi === sel.id);
      c.innerHTML = `<div class="at-card-head"><i class="lk lk-ships"></i><div><b>${esc(s.name || `MMSI ${s.mmsi}`)}</b><small class="muted">MMSI ${s.mmsi}${mmsiCountry(s.mmsi) ? ` · flag: ${esc(mmsiCountry(s.mmsi))}` : ''}</small></div></div>
        <p class="small">Ships report their position by radio (AIS). Open its live position, speed and route on a ship map:</p>
        ${links([['Open live position in Argos Atlas', argosLink(s.mmsi), true], ['MarineTraffic', marineTrafficLink(s.mmsi)]])}
        <div class="row" style="margin-top:8px">${watched ? `<button class="small btn-danger" data-unwatch="${s.mmsi}">Remove from watch list</button>` : `<button class="small" data-watch="${s.mmsi}">${icon('plus')}Add to watch list</button>`}</div>`;
    }
  }
  function renderRadar() {
    const box = $('[data-radar]', el), list = $('[data-flights]', el);
    if (!home) { box.innerHTML = '<p class="small muted">Set your location (Settings › General) to see the planes over your house.</p>'; list.innerHTML = ''; return; }
    const R = 120, k = R / st.range, near = st.aircraft.filter((a) => a.km <= st.range);
    const xy = (a) => { const r = a.km * k, t = (a.brg * Math.PI) / 180; return [R + Math.sin(t) * r, R - Math.cos(t) * r]; };
    const labelled = new Set(near.slice(0, 8).map((a) => a.id));
    box.innerHTML = `<svg class="at-radar" viewBox="0 0 ${R * 2} ${R * 2}" role="img" aria-label="${near.length} aircraft within ${st.range} km">
      ${[0.25, 0.5, 0.75, 1].map((f) => `<circle cx="${R}" cy="${R}" r="${R * f - 1}" class="ring"/>`).join('')}
      <line x1="${R}" y1="0" x2="${R}" y2="${R * 2}" class="axis"/><line x1="0" y1="${R}" x2="${R * 2}" y2="${R}" class="axis"/>
      <text x="${R + 4}" y="12" class="n">N</text><text x="${R * 2 - 4}" y="${R - 4}" class="rng" text-anchor="end">${st.range} km</text>
      <circle cx="${R}" cy="${R}" r="3" class="hq"/>
      ${near.map((a) => { const [x, y] = xy(a), on = st.sel?.type === 'flight' && st.sel.id === a.id; return `<g class="ac ${on ? 'sel' : ''} ${a.onGround ? 'gnd' : ''}" data-ac="${esc(a.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(a.callsign)} · ${flightLevel(a.altFt)} · ${a.km} km</title><circle r="9" class="hit"/><path d="M0,-6 L4,5 L0,3 L-4,5 Z" transform="rotate(${Math.round(a.heading ?? 0)})"/>${labelled.has(a.id) || on ? (() => { const left = x > R * 1.45, tx = left ? -7 : 7, anc = left ? 'end' : 'start'; return `<text x="${tx}" y="-4" text-anchor="${anc}">${esc(a.callsign)}</text><text x="${tx}" y="6" text-anchor="${anc}" class="fl">${a.onGround ? 'GND' : flightLevel(a.altFt)}</text>`; })() : ''}</g>`; }).join('')}
    </svg>`;
    list.innerHTML = near.length ? near.slice(0, 6).map((a) => `<li><button data-ac="${esc(a.id)}"><b>${esc(a.callsign)}</b><span>${a.onGround ? 'GND' : flightLevel(a.altFt)}</span><span>${a.km} km ${compass(a.brg)}</span></button></li>`).join('') : `<li class="muted">${st.status.air === 'live' ? `No aircraft within ${st.range} km right now.` : st.status.air === 'offline' ? `Aircraft feed offline (${esc(st.err.air || '')}).` : 'Looking…'}</li>`;
  }
  function renderWire() {
    const items = [];
    if (st.passes[0]) items.push(`<span class="w-iss">ISS PASS ${day(st.passes[0].start).toUpperCase()} ${hm(st.passes[0].start)} · ${st.passes[0].maxEl}° · ${compass(st.passes[0].startAz)}→${compass(st.passes[0].endAz)}</span>`);
    for (const q of st.quakes.filter((x) => x.mag >= 5).slice(0, 4)) items.push(`<a href="#quake=${esc(q.id)}" data-wq="${esc(q.id)}" class="w-quake">M${q.mag.toFixed(1)} QUAKE · ${esc(q.place.toUpperCase())} · ${ago(q.time).toUpperCase()}</a>`);
    if (home && st.status.air === 'live') items.push(`<span>${st.aircraft.filter((a) => a.km <= st.range).length} AIRCRAFT WITHIN ${st.range} KM OF HQ</span>`);
    for (const n of st.news.slice(0, 14)) items.push(`<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}${n.source ? ` <i>· ${esc(n.source)}</i>` : ''}</a>`);
    if (st.status.news === 'offline') items.push(`<span class="muted">HEADLINE FEED OFFLINE (${esc((st.err.news || '').toUpperCase())})</span>`);
    const run = $('[data-wire]', el);
    run.innerHTML = items.length ? items.map((x) => `<span class="w-item">${x}</span>`).join('<span class="w-sep">◆</span>') : '<span class="w-item muted">Waiting for intel…</span>';
    run.style.animationDuration = `${Math.max(30, run.textContent.length / 7)}s`;
  }
  const renderAll = () => { renderLayers(); renderShips(); renderCard(); renderRadar(); renderWire(); };

  // ---------- feeds ----------
  const ok = (k) => { st.status[k] = 'live'; st.at[k] = Date.now(); delete st.err[k]; };
  const bad = (k, e) => { st.status[k] = 'offline'; st.err[k] = e.message; };
  async function loadTle() {
    try {
      let cached = null; try { cached = JSON.parse(localStorage.getItem('sentinel.tle') || 'null'); } catch { /* none */ }
      if (cached && Date.now() - cached.at < EVERY.tle) st.tle = cached.tle;
      else {
        let lastErr = null;
        for (const u of SOURCES.tle) { try { st.tle = parseTle(await getJson(u)); break; } catch (e) { lastErr = e; } }
        if (!st.tle && cached) st.tle = cached.tle; // an old orbit is better than none
        if (!st.tle) throw lastErr || new Error('no orbit data');
        try { localStorage.setItem('sentinel.tle', JSON.stringify({ at: Date.now(), tle: st.tle })); } catch { /* full */ }
      }
      st.satrec = satrecOf(st.tle);
      updateIss(true);
      if (home) st.passes = nextPasses(st.satrec, home, Date.now(), { hours: 48 });
    } catch (e) { bad('iss', e); }
    renderAll();
  }
  function updateIss(track = false) {
    if (!st.satrec) return;
    const now = Date.now();
    st.iss = issAt(st.satrec, now);
    if (st.iss) ok('iss'); else bad('iss', new Error('orbit maths failed'));
    if (track || !st.track || now - st.trackAt > EVERY.track) { st.track = groundTrack(st.satrec, now, 45, 95, 1); st.trackAt = now; }
    globe?.setIss(st.iss, st.track);
    if (st.sel?.type === 'iss') { globe?.select({ type: 'iss', ...st.iss }); if (!el.querySelector('.at-card:hover')) renderCard(); }
  }
  async function loadAir() {
    if (!home) return;
    const km = Math.max(st.range, 40);
    try {
      let list;
      try { list = parseOpenSky(await getJson(SOURCES.opensky(bboxAround(home, km)))); } catch (e1) {
        try { list = parseAdsbLol(await getJson(SOURCES.adsblol(home, km))); } catch { throw e1; }
      }
      st.aircraft = nearby(list, home, km);
      ok('air');
    } catch (e) { bad('air', e); }
    renderLayers(); renderRadar(); renderWire(); if (st.sel?.type === 'flight') renderCard();
  }
  async function loadQuakes() {
    try { st.quakes = parseQuakes(await getJson(SOURCES.quakes)); ok('quakes'); globe?.setQuakes(st.quakes); } catch (e) { bad('quakes', e); }
    renderLayers(); renderWire(); if (st.sel?.type === 'quake') { renderCard(); selectOnGlobe(); }
  }
  async function loadNews() {
    try { st.news = parseNews(await getJson(SOURCES.news)); ok('news'); } catch (e) { bad('news', e); }
    renderWire();
  }

  // ---------- selection, search, links ----------
  function selectOnGlobe() {
    const s = st.sel;
    if (!globe || !s) { globe?.select(null); return; }
    const at = s.type === 'iss' ? st.iss : s.type === 'quake' ? st.quakes.find((q) => q.id === s.id) : s.type === 'flight' ? st.aircraft.find((a) => a.id === s.id) : null;
    globe.select(at ? { type: s.type, lat: at.lat, lon: at.lon } : null);
    if (at) globe.lookAt(at.lat, at.lon);
  }
  const api = {
    el, state: st,
    select(sel) {
      st.sel = sel;
      if (globe && sel?.type !== 'iss' && globe.follow) globe.follow = null;
      try { history.replaceState(null, '', `${location.pathname}${location.search}${makeHash(sel)}`); } catch { /* ignore */ }
      renderAll(); selectOnGlobe();
    },
    close,
    reload: () => Promise.all([loadTle(), loadAir(), loadQuakes(), loadNews()]),
  };
  function search(q) {
    const t = q.trim().toLowerCase(), res = [];
    if (!t) return res;
    if ('iss space station zarya'.includes(t) || /^(iss|space)/.test(t)) res.push({ sel: { type: 'iss' }, label: 'ISS — International Space Station' });
    if (validMmsi(t)) res.push({ sel: { type: 'ship', id: t }, label: `Ship MMSI ${t}${mmsiCountry(t) ? ` (${mmsiCountry(t)})` : ''}` });
    for (const s of st.ships) if (s.name.toLowerCase().includes(t) || s.mmsi.startsWith(t)) res.push({ sel: { type: 'ship', id: s.mmsi }, label: `${s.name || 'Ship'} · ${s.mmsi}` });
    for (const a of st.aircraft) if (a.callsign.toLowerCase().includes(t) || a.id.includes(t)) res.push({ sel: { type: 'flight', id: a.id }, label: `${a.callsign} · ${flightLevel(a.altFt)} · ${a.km} km` });
    for (const x of st.quakes) if (x.place.toLowerCase().includes(t)) res.push({ sel: { type: 'quake', id: x.id }, label: `M${x.mag.toFixed(1)} · ${x.place}` });
    if (!res.length && /^[a-z]{2,3}\d{1,4}[a-z]?$/i.test(t)) res.push({ sel: { type: 'flight', id: t.toUpperCase() }, label: `Flight ${t.toUpperCase()} (not overhead — look it up)` });
    return res.slice(0, 8);
  }
  const sf = $('[data-atsearch]', el), sr = $('[data-atresults]', el);
  let results = [];
  sf.q.addEventListener('input', () => { results = search(sf.q.value); sr.hidden = !results.length; sr.innerHTML = results.map((r, i) => `<button type="button" data-res="${i}">${esc(r.label)}</button>`).join(''); });
  sf.addEventListener('submit', (e) => { e.preventDefault(); results = search(sf.q.value); if (results[0]) { api.select(results[0].sel); sr.hidden = true; sf.q.blur(); } else toast('Nothing found. Try ISS, a callsign like BAW12, a 9-digit MMSI or a place.'); });

  async function saveShips(list) {
    try { const s = await S.api('/settings', { method: 'PATCH', body: { ships: list } }); S.settings = s; st.ships = cleanShips(s.ships); renderShips(); renderCard(); } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  el.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-addship]')) return;
    e.preventDefault();
    const m = e.target.mmsi.value.trim();
    if (!validMmsi(m)) return toast('An MMSI is 9 digits, e.g. 235052123.', { kind: 'err' });
    saveShips([...st.ships, { mmsi: m, name: e.target.name.value }]).then(() => { e.target.reset(); api.select({ type: 'ship', id: m }); });
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-ac], a[data-wq]');
    if (!b) { if (!e.target.closest('[data-atsearch]')) sr.hidden = true; return; }
    if ('atclose' in b.dataset) close();
    else if (b.dataset.layer) { const k = b.dataset.layer; st.layers[k] = !st.layers[k]; globe?.showLayer(k, st.layers[k]); $('.at-air', el).hidden = !st.layers.air; $('[data-ships]', el).hidden = !st.layers.ships; $('[data-addship]', el).hidden = !st.layers.ships; renderLayers(); }
    else if (b.dataset.ship) api.select({ type: 'ship', id: b.dataset.ship });
    else if (b.dataset.ac) api.select({ type: 'flight', id: b.dataset.ac });
    else if (b.dataset.res) { api.select(results[Number(b.dataset.res)].sel); sr.hidden = true; }
    else if (b.dataset.range) { st.range = Number(b.dataset.range); $$('[data-range]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); S.api('/settings', { method: 'PATCH', body: { airspaceKm: st.range } }).catch(() => {}); if (st.range > 40) loadAir(); else { renderRadar(); renderWire(); } }
    else if ('follow' in b.dataset && globe) { globe.follow = globe.follow === 'iss' ? null : 'iss'; if (globe.follow && st.iss) globe.lookAt(st.iss.lat, st.iss.lon); renderCard(); }
    else if (b.dataset.watch) saveShips([...st.ships, { mmsi: b.dataset.watch }]);
    else if (b.dataset.unwatch) saveShips(st.ships.filter((s) => s.mmsi !== b.dataset.unwatch));
    else if (b.dataset.wq) { e.preventDefault(); api.select({ type: 'quake', id: b.dataset.wq }); }
  });
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.sheet-backdrop')) { if (!sr.hidden) sr.hidden = true; else close(); } };
  document.addEventListener('keydown', onKey);

  function close() {
    timers.forEach(clearInterval);
    document.removeEventListener('keydown', onKey);
    globe?.destroy();
    el.remove();
    document.body.classList.remove('atlas-open');
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* ignore */ }
    open = null;
  }

  // ---------- go ----------
  const utc = () => { const u = $('[data-utc]', el); if (u) u.textContent = `UTC ${new Date().toISOString().slice(11, 19)}`; };
  timers.push(setInterval(utc, 1000), setInterval(() => { updateIss(); globe?.setSun(Date.now()); }, EVERY.iss), setInterval(loadAir, EVERY.air), setInterval(loadQuakes, EVERY.quakes), setInterval(loadNews, EVERY.news), setInterval(loadTle, EVERY.tle));
  utc();
  open = api;
  window.__atlas = api; // for the automated tests
  renderAll();
  if (initial) api.select(initial);
  else { const h = parseHash(location.hash); if (h) api.select(h); }
  api.reload();
  return api;
}
export const atlasOpen = () => open;
