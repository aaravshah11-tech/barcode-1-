// Match Photography — before & during the match (phone): hub, sync clock, tagging, checklist, positions, settings card.
import * as store from '../../core/store.js';
import { esc, icon, loadScript, keepAwake, toast, formatDate, plural, fmtClock } from '../../core/ui.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { matches, match, sideName } from '../sports/common.js';
import { MOMENT_TYPES, momentLabel, collectionName } from './match.js';
import { CHECKLIST, shoot, saveShoot, tagsOf, photosOf, momentsOf, liveMatchMs } from './data.js';

// ---------- home: list of shoots (matches) ----------
export function renderHome(root) {
  const list = matches().filter((m) => m.sport !== 'cricket' || photosOf(m.id).length);
  root.innerHTML = `<div class="page-head"><h1>📸 Match Photography</h1><a class="btn btn-primary" href="#/sports/new/rugby">${icon('plus')} New match</a></div>
    <p class="muted">Your phone is your touchline assistant: sync your camera clock, tag moments, tick off shots. Afterwards your computer sorts the photos by moment.</p>
    <a class="card clock-card" href="#/photo/clock"><span style="font-size:2rem">⏱️</span><div class="grow"><b>Camera clock sync</b><div class="small muted">Show the big clock, take one photo of it with your camera.</div></div>${icon('chev', 'chev')}</a>
    <div class="section"><div class="section-title">Matches</div>
    ${list.length ? `<div class="rows">${list.map((m) => `<a class="row" href="#/photo/match/${esc(m.id)}"><span class="thumb-sq">📸</span><div class="grow"><div class="row-title">${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))}</div>
      <div class="row-sub">${esc(formatDate(m.date))} · ${plural(tagsOf(m.id).length, 'tag')} · ${plural(photosOf(m.id).length, 'photo')}</div></div>${icon('chev', 'chev')}</a>`).join('')}</div>`
      : '<div class="card muted">Create a match first (Sports › Rugby › New match). It works without logging stats too.</div>'}</div>`;
}

// ---------- hub for one match ----------
export function renderHub(root, [id]) {
  const m = match(id);
  if (!m) { root.innerHTML = '<div class="empty"><h2>Match not found</h2><a class="btn" href="#/photo">Back</a></div>'; return; }
  const sh = shoot(id);
  const photos = photosOf(id);
  const picks = photos.filter((p) => p.flag === 'pick').length;
  const got = CHECKLIST.filter((c) => sh.checklist[c.id]).length;
  root.innerHTML = `<h1>${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))}</h1><p class="muted">${esc(formatDate(m.date))}${m.venue ? ` · ${esc(m.venue)}` : ''}</p>
    <div class="section-title">Before the match</div>
    <div class="hub-grid">
      <a class="hub-tile" href="#/photo/settings/${esc(id)}"><span>⚙️</span><b>Camera settings & sunset</b></a>
      <a class="hub-tile" href="#/photo/checklist/${esc(id)}"><span>✅</span><b>Shot checklist</b><small>${got}/${CHECKLIST.length} done</small></a>
      <a class="hub-tile" href="#/photo/positions/${esc(id)}"><span>📍</span><b>Where to stand</b><small>${plural(sh.positions.length, 'spot')} logged</small></a>
      <a class="hub-tile" href="#/photo/clock"><span>⏱️</span><b>Camera clock sync</b><small>${sh.offsetMs ? `Camera ${offsetText(sh.offsetMs)}` : 'Shoot the clock once'}</small></a>
    </div>
    <div class="section-title" style="margin-top:18px">During</div>
    <div class="hub-grid"><a class="hub-tile hub-big" href="#/photo/tag/${esc(id)}"><span>🏷️</span><b>Tag moments</b><small>${plural(tagsOf(id).length, 'tag')} · ${plural(momentsOf(id).length, 'moment')} incl. live stats</small></a>
      ${m.sport !== 'cricket' ? `<a class="hub-tile" href="#/sports/live/${esc(id)}"><span>${m.sport === 'rugby' ? '🏉' : '🏑'}</span><b>Log match stats</b><small>Stats count as tags too</small></a>` : ''}</div>
    <div class="section-title" style="margin-top:18px">After (on your computer)</div>
    <div class="hub-grid">
      <a class="hub-tile" href="#/photo/import/${esc(id)}"><span>📂</span><b>Import & auto-sort</b><small>${plural(photos.length, 'photo')}</small></a>
      <a class="hub-tile" href="#/photo/cull/${esc(id)}"><span>⭐</span><b>Cull & rate</b><small>${picks} picks</small></a>
      <a class="hub-tile" href="#/photo/export/${esc(id)}"><span>📤</span><b>Export picks</b></a>
      <a class="hub-tile" href="#/photo/stats"><span>📊</span><b>Photo stats</b></a>
    </div>`;
}

export const offsetText = (ms) => { const a = Math.abs(ms) / 1000; const t = a >= 60 ? `${Math.floor(a / 60)}m ${Math.round(a % 60)}s` : `${a.toFixed(1)}s`; return ms === 0 ? 'in sync' : `${t} ${ms > 0 ? 'fast' : 'slow'}`; };

// ---------- the big clock ----------
export function renderClock(root, _p, ctx) {
  ctx.hideNav(true);
  let release = null;
  keepAwake().then((r) => { release = r; });
  root.innerHTML = `<div class="sync-clock">
      <div class="sc-time" data-time></div><div class="sc-date" data-date></div>
      <div class="sc-qr" data-qr></div>
      <p class="sc-tip">Take a photo of this screen with your camera (fill the frame, keep it sharp). Do it before kick-off — once is enough. The computer reads the code and works out how far off your camera’s clock is.</p>
      <a class="btn" href="#/photo">Done</a></div>`;
  let lastQr = 0, raf = 0, ready = false;
  loadScript('vendor/qrcode.js').then(() => { ready = true; });
  const frame = () => {
    const now = Date.now();
    const d = new Date(now);
    root.querySelector('[data-time]').innerHTML = `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}<small>.${Math.floor(d.getMilliseconds() / 100)}</small>`;
    root.querySelector('[data-date]').textContent = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (ready && now - lastQr > 100) {
      lastQr = now;
      const qr = window.qrcode(0, 'L');
      qr.addData(`HBCLK:${now}`);
      qr.make();
      root.querySelector('[data-qr]').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    }
    raf = requestAnimationFrame(frame);
  };
  frame();
  return () => { cancelAnimationFrame(raf); release?.(); };
}

// ---------- tagging pad ----------
export function renderTag(root, [id], ctx) {
  ctx.hideNav(true);
  let number = '';
  let release = null;
  keepAwake().then((r) => { release = r; });
  const draw = () => {
    const m = match(id);
    if (!m) { root.innerHTML = '<div class="empty"><h2>Match not found</h2></div>'; return; }
    const all = momentsOf(id).slice(-6).reverse();
    root.innerHTML = `<div class="live">
      <div class="tag-head"><b>${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))}</b><span class="mono" data-mclock></span></div>
      <div class="section-title">Shirt number (optional)</div>
      <div class="num-strip">${Array.from({ length: 23 }, (_, i) => i + 1).map((n) => `<button class="num ${String(n) === number ? 'on' : ''}" data-num="${n}">${n}</button>`).join('')}</div>
      <div class="pad tag-pad">${MOMENT_TYPES.map((t) => `<button class="pad-btn ${t.id === 'try' ? 'score big' : ''}" data-tag="${t.id}"><span style="font-size:1.5rem">${t.emoji}</span>${esc(t.label)}</button>`).join('')}</div>
      <div class="section-title" style="margin-top:14px">Latest moments</div>
      <div class="list">${all.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.name)}</b> <span class="small muted">${x.source === 'stats' ? 'from live stats' : 'tag'}</span></div></div>`).join('') || '<div class="list-item muted">Nothing yet.</div>'}</div>
      <div class="live-links"><a class="btn btn-ghost" href="#/photo/positions/${esc(id)}">📍 Log where I’m standing</a><a class="btn btn-ghost" href="#/photo/checklist/${esc(id)}">✅ Checklist</a></div>
      <div class="undo-bar"><div class="grow muted small">${number ? `Next tag: <b>#${esc(number)}</b>` : 'Tap a number first to include the player.'}</div><button class="btn btn-danger" data-undo ${tagsOf(id).length ? '' : 'disabled'}>${icon('undo')} Undo tag</button></div>
    </div>`;
    tick();
  };
  const tick = () => {
    const m = match(id);
    const el = root.querySelector('[data-mclock]');
    if (el && m) { const ms = liveMatchMs(m); el.textContent = ms != null ? fmtClock(ms) : new Date().toLocaleTimeString([], { hour12: false }); }
  };
  const t = setInterval(tick, 500);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    unlockAudio();
    if (b.dataset.num) { number = number === b.dataset.num ? '' : b.dataset.num; draw(); }
    else if (b.dataset.tag) {
      const m = match(id);
      const rec = await store.put('photoTags', { matchId: id, t: Date.now(), type: b.dataset.tag, number, matchMs: liveMatchMs(m) });
      feedback('ok');
      toast(`Tagged: ${collectionName(rec)}`, { kind: 'ok', timeout: 1800 });
      number = '';
      draw();
    } else if ('undo' in b.dataset) {
      const last = tagsOf(id).at(-1);
      if (last) { await store.remove('photoTags', last.id); toast(`Removed ${momentLabel(last.type)}`); draw(); }
    }
  });
  draw();
  const off = store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'events' || c.c === 'photoTags')) draw(); });
  return () => { clearInterval(t); off(); release?.(); };
}

// ---------- checklist ----------
export function renderChecklist(root, [id]) {
  const draw = () => {
    const sh = shoot(id);
    const photos = photosOf(id);
    const pickedTypes = new Set(photos.filter((p) => p.flag === 'pick' || (p.rating || 0) >= 3).map((p) => p.momentType));
    const left = CHECKLIST.filter((c) => !sh.checklist[c.id]);
    root.innerHTML = `<h1>Shot checklist</h1>
      <p class="muted">${left.length ? `Still to get: <b>${esc(left.map((c) => c.label).join(', '))}</b>` : '🎉 Everything on the list is done!'}</p>
      <div class="list check-list">${CHECKLIST.map((c) => `<label class="list-item"><input type="checkbox" data-item="${c.id}" ${sh.checklist[c.id] ? 'checked' : ''}><div class="grow"><b>${esc(c.label)}</b>${c.moment && pickedTypes.has(c.moment) && !sh.checklist[c.id] ? '<div class="small" style="color:var(--ok)">You have keepers for this — tick it?</div>' : ''}</div></label>`).join('')}</div>
      <a class="btn btn-block" href="#/photo/match/${esc(id)}" style="margin-top:14px">Back to match</a>`;
  };
  root.addEventListener('change', async (e) => {
    const k = e.target.dataset.item;
    if (!k) return;
    const sh = shoot(id);
    await saveShoot(id, { checklist: { ...sh.checklist, [k]: e.target.checked } });
    feedback('ok');
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'photoShoots' && c.record.id === id) && !root.contains(document.activeElement)) draw(); });
}

// ---------- positioning ----------
export const SPOTS = [
  { id: 'corner_att', label: 'Try-line corner (attacking end)', x: 92, y: 8, tips: 'Tries diving in, wingers in full flight. Kneel low behind the dead-ball line near the corner flag.', moments: ['try', 'celebration'] },
  { id: 'corner_att2', label: 'Other try-line corner', x: 92, y: 62, tips: 'Same as above for attacks down the far wing.', moments: ['try'] },
  { id: 'posts', label: 'Behind the posts', x: 99, y: 35, tips: 'Kicker’s face and the ball coming at you on conversions and penalties.', moments: ['kick'] },
  { id: 'lineout22', label: 'Touchline, level with the lineout (22)', x: 78, y: 0, tips: 'Jumpers at full stretch. Shoot from the 5m line level with the jump.', moments: ['lineout'] },
  { id: 'halfway', label: 'Halfway, touchline', x: 50, y: 0, tips: 'Kick-off, scrums in midfield, line breaks either way.', moments: ['scrum', 'line_break', 'tackle'] },
  { id: 'scrum_side', label: '10m line, close to scrums', x: 62, y: 70, tips: 'Front-row faces and scrum-half box kicks.', moments: ['scrum'] },
  { id: 'tunnel', label: 'Tunnel / dug-out', x: 50, y: 74, tips: 'Walk-out, coach reactions, handshakes, team photo.', moments: ['team_photo', 'handshakes'] },
];

export function pitchSvg(highlight = '', counts = {}) {
  return `<svg viewBox="-4 -6 108 84" class="pitch" role="img" aria-label="Rugby pitch with suggested positions">
    <rect x="0" y="0" width="100" height="70" rx="1" class="pitch-grass"/>
    ${[0, 5, 22, 40, 50, 60, 78, 95, 100].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="70" class="pitch-line${[5, 95].includes(x) ? ' thin' : ''}${[40, 60].includes(x) ? ' dash' : ''}"/>`).join('')}
    <line x1="0" y1="5" x2="100" y2="5" class="pitch-line thin dash"/><line x1="0" y1="65" x2="100" y2="65" class="pitch-line thin dash"/>
    <path d="M5 31v-6M5 39v6M95 31v-6M95 39v6" class="pitch-post"/><path d="M5 31h0M95 31" class="pitch-post"/>
    ${SPOTS.map((s) => `<g class="spot ${s.id === highlight ? 'on' : ''}" data-spot="${s.id}"><circle cx="${s.x}" cy="${s.y}" r="3.6"/><text x="${s.x}" y="${s.y + 1.4}" text-anchor="middle">${counts[s.id] ?? ''}</text></g>`).join('')}
  </svg>`;
}

export function renderPositions(root, [id]) {
  let sel = '';
  const draw = () => {
    const sh = shoot(id);
    const counts = {};
    sh.positions.forEach((p) => { counts[p.spot] = (counts[p.spot] || 0) + 1; });
    const s = SPOTS.find((x) => x.id === sel);
    root.innerHTML = `<h1>Where to stand</h1><p class="muted">Tap a spot for tips. Tap “I’m here” when you move, so your stats can show your best spots.</p>
      ${pitchSvg(sel, counts)}
      ${s ? `<div class="card"><h2>${esc(s.label)}</h2><p>${esc(s.tips)}</p><p class="small muted">Good for: ${esc(s.moments.map(momentLabel).join(', '))}</p>
        <button class="btn btn-primary btn-lg btn-block" data-here>${icon('pin')} I’m here now</button></div>` : '<div class="card muted">Tap a circle on the pitch.</div>'}
      <div class="section"><div class="section-title">Logged positions</div><div class="list">${[...sh.positions].reverse().slice(0, 12).map((p) => `<div class="list-item"><div class="grow">${esc(SPOTS.find((x) => x.id === p.spot)?.label || p.spot)}</div><span class="small muted">${new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') || '<div class="list-item muted">None yet.</div>'}</div></div>`;
  };
  root.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-spot]');
    if (g) { sel = g.dataset.spot; draw(); return; }
    if (e.target.closest('[data-here]')) {
      const sh = shoot(id);
      await saveShoot(id, { positions: [...sh.positions, { spot: sel, t: Date.now() }] });
      feedback('ok');
      toast('Position logged', { kind: 'ok' });
      draw();
    }
  });
  draw();
}

// ---------- camera settings card + sunset ----------
const PRESETS = [
  ['Action (running, tackles)', '1/1000–1/2000 s', 'f/2.8–f/4', 'Auto ISO', 'Continuous AF (AI Servo / AF-C), burst mode, zone AF.'],
  ['Background blur (portraits, celebrations)', '1/800 s+', 'f/2.8 (widest)', 'Auto ISO', 'Get low, longest lens, fill the frame with faces.'],
  ['Team photo', '1/250 s', 'f/8', 'ISO 100–400', 'Single-shot AF on the middle row; take 5+ frames for blinks.'],
  ['Kicks at goal', '1/1600 s', 'f/4', 'Auto ISO', 'Pre-focus on the kicker, burst as the leg swings.'],
];
const LIGHT = [['☀️ Bright sun', 'ISO 100–400. Watch for harsh shadows; shoot with the sun behind you.'], ['☁️ Cloudy', 'ISO 800–1600 to keep 1/1000 s.'], ['🌆 Late afternoon', 'ISO 1600–3200; open up to f/2.8.'], ['💡 Floodlights', 'ISO 3200–6400+, f/2.8, 1/800 s is OK. Set white balance manually (~4000K) to stop colour shifts.']];

async function sunsetFor(name, date, coords) {
  let lat = coords?.lat, lon = coords?.lon, place = coords?.name;
  if (lat == null) {
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`)).json();
    const r = g.results?.[0];
    if (!r) throw new Error('Place not found — try the town name.');
    lat = r.latitude; lon = r.longitude; place = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ');
  }
  const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto&start_date=${date}&end_date=${date}`)).json();
  const sunset = f.daily?.sunset?.[0];
  if (!sunset) throw new Error('No sunset data for that date (forecasts only go about 2 weeks ahead).');
  return { lat, lon, place, sunset, tz: f.timezone };
}

export function renderSettingsCard(root, [id]) {
  const m = id ? match(id) : null;
  let sun = shoot(id || 'none').sun || null;
  let err = '';
  let place = sun?.place || m?.venue || '';
  const draw = () => {
    const kick = shoot(id || 'none').kickoff || '';
    const sunsetTime = sun?.sunset ? sun.sunset.slice(11, 16) : '';
    let warn = '';
    if (kick && sunsetTime && m) {
      const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
      const end = toMin(kick) + (m.format?.periods || 2) * (m.format?.periodMins || 40) + 15;
      const diff = toMin(sunsetTime) - end;
      warn = diff < 0 ? `Sunset is ${-diff} min before the final whistle — expect floodlights or very low light in the 2nd half.` : diff < 60 ? `Golden hour during the 2nd half — lovely light, but ISO will climb.` : 'Plenty of daylight for the whole match.';
    }
    root.innerHTML = `<h1>Camera settings</h1>
      <div class="card"><h2>🌇 Sunset</h2>
        <div class="field-row"><label class="field"><span>Place</span><input data-place value="${esc(place)}" placeholder="Town or ground"></label>
        <label class="field"><span>Kick-off</span><input type="time" data-kick value="${esc(kick)}"></label></div>
        <div class="btn-row"><button class="btn btn-primary" data-sun>Get sunset time</button><button class="btn" data-here>📍 Use my location</button></div>
        ${err ? `<p style="color:var(--danger)">${esc(err)}</p>` : ''}
        ${sunsetTime ? `<div class="sunset"><b>${esc(sunsetTime)}</b><span>sunset${sun.place ? ` · ${esc(sun.place)}` : ''} · golden hour from about ${esc(String(+sunsetTime.slice(0, 2) - 1).padStart(2, '0') + sunsetTime.slice(2))}</span></div>` : ''}
        ${warn ? `<div class="banner banner-warn">${icon('sun')}<div class="grow">${esc(warn)}</div></div>` : ''}</div>
      <div class="section"><div class="section-title">Starting points</div>
        <div class="table-wrap card"><table class="table"><thead><tr><th>Shot</th><th>Shutter</th><th>Aperture</th><th>ISO</th></tr></thead><tbody>
        ${PRESETS.map((p) => `<tr><td><b>${esc(p[0])}</b><div class="small muted" style="white-space:normal">${esc(p[4])}</div></td><td>${esc(p[1])}</td><td>${esc(p[2])}</td><td>${esc(p[3])}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="section"><div class="section-title">ISO guide</div><div class="list">${LIGHT.map(([a, b]) => `<div class="list-item"><div class="grow"><b>${a}</b><div class="small muted">${esc(b)}</div></div></div>`).join('')}</div></div>
      <p class="small muted">Sunset data: Open-Meteo (free). These are starting points — check your histogram and adjust.</p>`;
  };
  const saveSun = (s) => { sun = s; if (id) saveShoot(id, { sun: s }); };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    err = '';
    const date = m?.date || new Date().toISOString().slice(0, 10);
    try {
      if ('sun' in b.dataset) {
        if (!place.trim()) throw new Error('Type the town or ground first.');
        b.disabled = true;
        saveSun(await sunsetFor(place, date));
        place = sun.place || place;
      }
      if ('here' in b.dataset) {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
        saveSun(await sunsetFor('', date, { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Your location' }));
      }
    } catch (x) { err = x.code === 1 ? 'Location permission was denied.' : navigator.onLine === false ? 'You’re offline — sunset needs the internet.' : x.message || 'Couldn’t get the sunset time.'; }
    draw();
  });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-place]')) place = e.target.value; });
  root.addEventListener('change', (e) => { if (e.target.matches('[data-kick]') && id) saveShoot(id, { kickoff: e.target.value }).then(draw); });
  draw();
}
