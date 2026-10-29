// The International Space Station from its published orbit (TLE), worked out on this device:
// where it is now, its track over the Earth, and when it next passes over your house.
import * as sat from '../vendor/satellite/satellite.es.js';

/** CelesTrak's 3-line text, or wheretheiss.at's JSON → { name, line1, line2 } */
export function parseTle(input) {
  if (input && typeof input === 'object' && input.line1) return { name: input.name || 'ISS (ZARYA)', line1: input.line1.trim(), line2: input.line2.trim() };
  const lines = String(input || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => l.startsWith('1 '));
  if (i < 0 || !lines[i + 1]?.startsWith('2 ')) throw new Error('That isn’t an orbit (TLE).');
  return { name: i > 0 ? lines[i - 1] : 'ISS (ZARYA)', line1: lines[i], line2: lines[i + 1] };
}
export const satrecOf = (tle) => sat.twoline2satrec(tle.line1, tle.line2);
/** How old the orbit data is, in days (older than ~3 days gets less accurate). */
export const tleAgeDays = (satrec, ms) => (ms / 86400000 + 2440587.5 - satrec.jdsatepoch) ;

/** Position now: { lat, lon, altKm, speedKmh } */
export function issAt(satrec, ms) {
  const d = new Date(ms), pv = sat.propagate(satrec, d);
  if (!pv?.position) return null;
  const g = sat.eciToGeodetic(pv.position, sat.gstime(d)), v = pv.velocity;
  return { lat: sat.degreesLat(g.latitude), lon: sat.degreesLong(g.longitude), altKm: Math.round(g.height), speedKmh: Math.round(Math.hypot(v.x, v.y, v.z) * 3600) };
}
/** The track over the ground: points every `stepMin` minutes from `back` minutes ago to `ahead` minutes on. */
export function groundTrack(satrec, ms, back = 45, ahead = 90, stepMin = 1) {
  const out = [];
  for (let m = -back; m <= ahead; m += stepMin) { const p = issAt(satrec, ms + m * 60000); if (p) out.push([p.lat, p.lon, m]); }
  return out;
}
/** Height above the horizon (°) and compass direction as seen from home. */
export function lookFrom(satrec, home, ms) {
  const d = new Date(ms), pv = sat.propagate(satrec, d);
  if (!pv?.position) return null;
  const ecf = sat.eciToEcf(pv.position, sat.gstime(d));
  const look = sat.ecfToLookAngles({ latitude: sat.degreesToRadians(home.lat), longitude: sat.degreesToRadians(home.lon), height: (home.altKm || 0.05) }, ecf);
  return { el: (look.elevation * 180) / Math.PI, az: ((look.azimuth * 180) / Math.PI + 360) % 360, rangeKm: look.rangeSat };
}
/**
 * The next times it rises above the horizon at home (at least `minEl` degrees high at its best):
 * [{ start, end, maxAt, maxEl, startAz, endAz }]
 */
export function nextPasses(satrec, home, from, { hours = 48, minEl = 10, max = 5 } = {}) {
  const out = [], step = 30000, end = from + hours * 3600000;
  let cur = null;
  for (let t = from; t <= end && out.length < max; t += step) {
    const l = lookFrom(satrec, home, t);
    if (!l) continue;
    if (l.el > 0) {
      if (!cur) cur = { start: refine(satrec, home, t - step, t), startAz: l.az, maxEl: l.el, maxAt: t };
      if (l.el > cur.maxEl) { cur.maxEl = l.el; cur.maxAt = t; }
      cur.endAz = l.az;
    } else if (cur) {
      cur.end = refine(satrec, home, t - step, t, true);
      if (cur.maxEl >= minEl) out.push({ ...cur, maxEl: Math.round(cur.maxEl) });
      cur = null;
    }
  }
  return out;
}
// find the moment it crosses the horizon (to about a second)
function refine(satrec, home, a, b, setting = false) {
  for (let i = 0; i < 6; i++) {
    const m = (a + b) / 2, up = (lookFrom(satrec, home, m)?.el ?? -1) > 0;
    if (up !== setting) b = m; else a = m;
  }
  return Math.round((a + b) / 2);
}
