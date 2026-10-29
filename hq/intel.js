// INTEL PANEL ("Situation"): local time, weather, sunrise/sunset, world clocks, and the Mission Briefing.
import { esc } from '../shared/ui.js';
import { sunTimes, isDark } from '../shared/sun.js';
import { fmtDuration } from '../shared/diag.js';

const WORLD = [['LONDON', 'Europe/London'], ['NEW YORK', 'America/New_York'], ['TOKYO', 'Asia/Tokyo'], ['SYDNEY', 'Australia/Sydney']];
const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Today's sunrise/sunset for the saved location (local day), plus how long until the next one. */
export function sunToday(loc, now = Date.now()) {
  if (!loc) return null;
  const noon = new Date(now); noon.setHours(12, 0, 0, 0);
  const s = sunTimes(noon.getTime(), loc.lat, loc.lon);
  const dark = isDark(now, loc.lat, loc.lon);
  let next = null;
  if (!s.polar) {
    if (now < s.sunrise) next = { what: 'Sunrise', in: s.sunrise - now };
    else if (now < s.sunset) next = { what: 'Sunset', in: s.sunset - now };
    else { const t = new Date(noon); t.setDate(t.getDate() + 1); const s2 = sunTimes(t.getTime(), loc.lat, loc.lon); if (s2.sunrise) next = { what: 'Sunrise', in: s2.sunrise - now }; }
  }
  return { ...s, dark, next };
}

/** Plain-words rain line from the forecast (null when nothing's coming). */
export function rainLine(w) {
  if (!w) return null;
  if (w.rainIn === 0) return `${w.kind === 'snow' ? 'Snow' : 'Precipitation'} now`;
  if (w.rainIn != null) return `Precipitation expected in about ${w.rainIn < 60 ? `${Math.max(5, Math.round(w.rainIn / 5) * 5)} min` : `${Math.round(w.rainIn / 60)} h`}`;
  return 'No rain expected in the next few hours';
}

let sig = '';
export function renderIntel(box, S) {
  if (!box) return;
  const now = new Date();
  if (!box.querySelector('[data-itime]')) {
    sig = '';
    box.innerHTML = `<div class="intel-time" data-itime></div><div class="small muted" data-idate></div>
      <div data-wx></div>
      <div class="world">${WORLD.map(([n, tz]) => `<div><span>${n}</span><b class="mono" data-tz="${tz}"></b></div>`).join('')}</div>
      <button class="small brief-btn" data-briefing>Mission briefing</button>`;
  }
  box.querySelector('[data-itime]').textContent = now.toLocaleTimeString('en-GB');
  box.querySelector('[data-idate]').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  box.querySelectorAll('[data-tz]').forEach((el) => { el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: el.dataset.tz }); });
  // weather + sun: only redrawn when something changes (or each minute)
  const loc = S.settings.location, w = S.weather;
  const key = `${loc?.lat},${loc?.lon},${w?.at},${w?.stale},${Math.floor(now / 60000)}`;
  if (key === sig) return;
  sig = key;
  const wx = box.querySelector('[data-wx]');
  if (!loc) {
    wx.innerHTML = `<p class="small muted wx-empty">Weather and sunrise/sunset need your town: <button class="link-btn" data-setloc>set location</button></p>`;
    return;
  }
  const sun = sunToday(loc, now.getTime());
  const rain = rainLine(w);
  wx.innerHTML = `
    ${w ? `<div class="wx"><b class="wx-temp mono">${w.temp}°</b><div><div>${esc(w.text)}${w.stale ? ' <span class="muted small">(not updated)</span>' : ''}</div>
      <div class="small muted">Feels ${w.feels}° · wind ${w.wind} mph${w.high != null ? ` · ${w.high}° / ${w.low}°` : ''}</div></div></div>
      ${rain ? `<div class="small wx-rain ${w.rainIn != null ? 'wet' : ''}">${esc(rain)}</div>` : ''}` : '<p class="small muted">Getting the weather…</p>'}
    <dl class="kv sun">
      ${sun.polar ? `<dt>Sun</dt><dd>${sun.polar === 'day' ? 'Up all day (polar day)' : 'Down all day (polar night)'}</dd>`
        : `<dt>Sunrise</dt><dd class="mono">${hm(sun.sunrise)}</dd><dt>Sunset</dt><dd class="mono">${hm(sun.sunset)}</dd>`}
      ${sun.next ? `<dt>${sun.next.what} in</dt><dd>${fmtDuration(sun.next.in)}</dd>` : ''}
    </dl>
    <div class="small muted">${esc(loc.name)}${w ? ` · updated ${hm(w.at)}` : ''}</div>`;
}
