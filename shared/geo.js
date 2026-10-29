// Earth maths for the Global Intel screen. Pure, unit tested.
const RAD = Math.PI / 180, R_KM = 6371;

/** Decode a TopoJSON file's arcs into lines of [lon, lat] (country borders and coasts). */
export function decodeArcs(topo) {
  const [sx, sy] = topo.transform?.scale || [1, 1], [tx, ty] = topo.transform?.translate || [0, 0];
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
}

/** Latitude/longitude → a point on a sphere of radius r (y is up, longitude 0 faces +z). */
export function latLonToVec(lat, lon, r = 1) {
  const phi = lat * RAD, lam = lon * RAD;
  return [r * Math.cos(phi) * Math.sin(lam), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lam)];
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Compass bearing from a to b (0 = north, 90 = east). */
export function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
/** A box around a point, radius in km (for asking "which planes are near me?"). */
export function bboxAround({ lat, lon }, km) {
  const dLat = km / 111.32, dLon = km / (111.32 * Math.max(0.05, Math.cos(lat * RAD)));
  return { lamin: lat - dLat, lamax: lat + dLat, lomin: lon - dLon, lomax: lon + dLon };
}
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/** Where the sun is overhead right now (for the day/night line on the globe). */
export function subsolar(ms) {
  const d = new Date(ms), jd = ms / 86400000 + 2440587.5, n = jd - 2451545;
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.0000004 * n) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda)) / RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const eqMin = 4 * (((L - ra + 540) % 360) - 180); // equation of time (minutes)
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lon = (720 - utcMin - eqMin) / 4;
  lon = ((lon + 540) % 360) - 180;
  return { lat: decl, lon };
}
