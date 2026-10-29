// WEATHER (runs on the HQ computer): asks Open-Meteo for the forecast every 15 minutes, once a
// location is set in Settings. Only the town's rough position (about 1 km) is sent.
import { forecastUrl, parseWeather } from '../../shared/weather.js';

const EVERY = 15 * 60000;

export function startWeather({ hq, db }) {
  hq.weather = db.getSetting('weather', null);
  let timer = null, busy = null, lastKey = '';
  const key = () => { const l = hq.settings().location; return l ? `${l.lat},${l.lon}` : ''; };

  async function refresh() {
    const loc = hq.settings().location;
    if (!loc) { hq.weather = null; db.setSetting('weather', null); hq.broadcast({ t: 'weather', weather: null }); return null; }
    if (busy) return busy;
    busy = (async () => {
      try {
        const ctl = new AbortController();
        const kill = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(forecastUrl(loc.lat, loc.lon), { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(kill);
        if (!r.ok) throw new Error(`weather service said ${r.status}`);
        const w = { ...parseWeather(await r.json(), hq.now()), place: loc.name };
        hq.weather = w;
        db.setSetting('weather', w);
        hq.broadcast({ t: 'weather', weather: w });
        return w;
      } catch (e) {
        // keep showing the last forecast, marked as old
        if (hq.weather) { hq.weather = { ...hq.weather, stale: true }; hq.broadcast({ t: 'weather', weather: hq.weather }); }
        throw Object.assign(new Error(`Couldn’t get the weather (${e.name === 'AbortError' ? 'timed out' : e.message}).`), { status: 502 });
      } finally { busy = null; }
    })();
    return busy;
  }
  hq.refreshWeather = refresh;
  hq.on('broadcast', (m) => { if (m.t === 'settings' && key() !== lastKey) { lastKey = key(); refresh().catch(() => {}); } });
  lastKey = key();
  if (lastKey && (!hq.weather || hq.now() - hq.weather.at > EVERY)) refresh().catch(() => {});
  timer = setInterval(() => { if (key()) refresh().catch(() => {}); }, EVERY);
  return { refresh, stop: () => clearInterval(timer) };
}
