// GLOBAL INTEL feeds: turning each free service's reply into one simple shape. Pure, unit tested.
//   aircraft  — OpenSky Network (or adsb.lol as a back-up)
//   quakes    — USGS earthquake feed (last 24 h, magnitude 2.5+)
//   news      — GDELT (headlines)          ships — a watch list of MMSI numbers (live map: Argos Atlas)
import { distanceKm, bearing } from './geo.js';

const M_TO_FT = 3.28084, MS_TO_KT = 1.943844;

/** OpenSky /states/all → aircraft. */
export function parseOpenSky(j) {
  return (j?.states || []).filter((s) => s[5] != null && s[6] != null).map((s) => ({
    id: String(s[0]), callsign: String(s[1] || '').trim() || String(s[0]).toUpperCase(), country: s[2] || '',
    lon: s[5], lat: s[6], altFt: s[7] != null ? Math.round(s[7] * M_TO_FT) : s[13] != null ? Math.round(s[13] * M_TO_FT) : null,
    onGround: !!s[8], speedKt: s[9] != null ? Math.round(s[9] * MS_TO_KT) : null, heading: s[10] ?? null, climb: s[11] != null ? Math.round(s[11] * 196.85) : null, src: 'OpenSky',
  }));
}
/** adsb.lol /v2/point → aircraft. */
export function parseAdsbLol(j) {
  return (j?.ac || []).filter((a) => a.lat != null && a.lon != null).map((a) => ({
    id: String(a.hex), callsign: String(a.flight || '').trim() || String(a.hex).toUpperCase(), country: '', lon: a.lon, lat: a.lat,
    altFt: typeof a.alt_baro === 'number' ? a.alt_baro : null, onGround: a.alt_baro === 'ground', speedKt: a.gs != null ? Math.round(a.gs) : null,
    heading: a.track ?? a.true_heading ?? null, climb: a.baro_rate ?? null, type: a.t || '', reg: a.r || '', src: 'adsb.lol',
  }));
}
/** Add distance and direction from home, keep those within range, nearest first. */
export function nearby(aircraft, home, km) {
  return aircraft.map((a) => ({ ...a, km: Math.round(distanceKm(home, a) * 10) / 10, brg: Math.round(bearing(home, a)) })).filter((a) => a.km <= km).sort((a, b) => a.km - b.km);
}
/** Flight level wording: 35,000 ft → "FL350"; low → "2,300 ft". */
export const flightLevel = (ft) => (ft == null ? '—' : ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${ft.toLocaleString('en-GB')} ft`);

/** USGS GeoJSON → quakes (newest first). */
export function parseQuakes(j) {
  return (j?.features || []).map((f) => ({
    id: f.id, mag: Math.round((f.properties.mag ?? 0) * 10) / 10, place: f.properties.place || 'Unknown location', time: f.properties.time,
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: Math.round(f.geometry.coordinates[2] ?? 0), url: f.properties.url || '', tsunami: !!f.properties.tsunami,
  })).sort((a, b) => b.time - a.time);
}
/** GDELT article list → headlines. */
export function parseNews(j) {
  const seen = new Set();
  return (j?.articles || []).map((a) => ({ title: String(a.title || '').replace(/\s+/g, ' ').trim(), url: a.url, source: a.domain || '', at: gdeltTime(a.seendate) }))
    .filter((a) => a.title && a.url && !seen.has(a.title.toLowerCase()) && seen.add(a.title.toLowerCase())).slice(0, 25);
}
const gdeltTime = (s) => { const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s || ''); return m ? Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) : null; };

// ---------- ships ----------
/** The first 3 digits of an MMSI say which country the ship is registered in (a few common ones). */
const MID = { 232: 'United Kingdom', 233: 'United Kingdom', 234: 'United Kingdom', 235: 'United Kingdom', 211: 'Germany', 218: 'Germany', 219: 'Denmark', 220: 'Denmark', 224: 'Spain', 225: 'Spain', 226: 'France', 227: 'France', 228: 'France', 229: 'Malta', 230: 'Finland', 231: 'Faroe Islands', 236: 'Gibraltar', 237: 'Greece', 238: 'Croatia', 239: 'Greece', 240: 'Greece', 241: 'Greece', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands', 247: 'Italy', 248: 'Malta', 249: 'Malta', 250: 'Ireland', 255: 'Madeira (Portugal)', 256: 'Malta', 257: 'Norway', 258: 'Norway', 259: 'Norway', 261: 'Poland', 263: 'Portugal', 265: 'Sweden', 266: 'Sweden', 271: 'Turkey', 273: 'Russia', 303: 'Alaska (USA)', 304: 'Antigua and Barbuda', 305: 'Antigua and Barbuda', 308: 'Bahamas', 309: 'Bahamas', 311: 'Bahamas', 316: 'Canada', 338: 'USA', 351: 'Panama', 352: 'Panama', 353: 'Panama', 354: 'Panama', 355: 'Panama', 356: 'Panama', 357: 'Panama', 366: 'USA', 367: 'USA', 368: 'USA', 369: 'USA', 370: 'Panama', 371: 'Panama', 372: 'Panama', 373: 'Panama', 412: 'China', 413: 'China', 414: 'China', 431: 'Japan', 432: 'Japan', 440: 'South Korea', 441: 'South Korea', 477: 'Hong Kong', 503: 'Australia', 512: 'New Zealand', 533: 'Malaysia', 538: 'Marshall Islands', 563: 'Singapore', 564: 'Singapore', 565: 'Singapore', 566: 'Singapore', 636: 'Liberia', 637: 'Liberia' };
export const validMmsi = (s) => /^\d{9}$/.test(String(s).trim());
export const mmsiCountry = (mmsi) => MID[String(mmsi).slice(0, 3)] || null;
export const argosLink = (mmsi) => `https://argosatlas.com/map/#ship=${encodeURIComponent(mmsi)}`;
export const marineTrafficLink = (mmsi) => `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${encodeURIComponent(mmsi)}`;
export function cleanShips(list) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const m = String(s?.mmsi ?? s).trim();
    if (!validMmsi(m) || seen.has(m)) continue;
    seen.add(m);
    out.push({ mmsi: m, name: String(s?.name || '').replace(/[<>]/g, '').trim().slice(0, 40) });
  }
  return out.slice(0, 30);
}

// ---------- links to one item (like #ship=235052123) ----------
export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (h === 'iss') return { type: 'iss' };
  const m = /^(ship|flight|quake)=([\w.-]{1,40})$/.exec(h);
  return m ? { type: m[1], id: decodeURIComponent(m[2]) } : null;
}
export const makeHash = (sel) => (!sel ? '' : sel.type === 'iss' ? '#iss' : `#${sel.type}=${encodeURIComponent(sel.id)}`);
