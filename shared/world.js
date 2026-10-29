// LIVE WORLD maths: sun direction and shadows on the floor plan, day phase, night vision,
// rain alerts and weather-particle counts. Pure, unit tested.
const RAD = Math.PI / 180;

/** Compass points for "which way does the top of your floor plan face?" */
export const NORTH_OPTIONS = [[0, 'North'], [45, 'North-east'], [90, 'East'], [135, 'South-east'], [180, 'South'], [225, 'South-west'], [270, 'West'], [315, 'North-west']];

/**
 * Turn a compass bearing (0 = north, 90 = east) into a direction on the floor plan (x → right, y → down).
 * northDeg = the compass bearing the TOP of the plan faces (0 = the top is north).
 */
export function planDir(bearing, northDeg = 0) {
  const a = (bearing - northDeg) * RAD; // angle clockwise from the plan's "up"
  return [Math.sin(a), -Math.cos(a)];
}

/** Where shadows fall: a unit direction on the plan (away from the sun) and how far per metre of height. */
export function shadowVector(sun, northDeg = 0) {
  if (!sun || sun.altitude <= 0.5) return null; // sun down (or on the horizon): no shadow
  const [dx, dy] = planDir(sun.azimuth + 180, northDeg);
  return { dx, dy, k: Math.min(6, 1 / Math.tan(sun.altitude * RAD)) }; // capped so low sun doesn't paint the whole map
}

/** Convex hull (monotone chain). */
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The shadow a room of this height casts on the ground (as a polygon on the plan). */
export function shadowPolygon(points, height, sv) {
  if (!sv || points.length < 3) return null;
  const off = height * sv.k;
  return hull([...points, ...points.map(([x, y]) => [x + sv.dx * off, y + sv.dy * off])]);
}

/** day · golden (sun low) · twilight (just set) · night */
export function skyPhase(altitude) {
  if (altitude == null) return null;
  if (altitude > 6) return 'day';
  if (altitude > -0.833) return 'golden';
  if (altitude > -6) return 'twilight';
  return 'night';
}
export const PHASE_LABEL = { day: 'Daylight', golden: 'Golden hour', twilight: 'Twilight', night: 'Night' };

const mins = (s) => Number(String(s).slice(0, 2)) * 60 + Number(String(s).slice(3, 5));
/** Night vision: mode 'auto' (after sunset — or, with no location, in the night hours), 'on' or 'off'. */
export function nightVision(mode, { altitude = null, now = new Date(), nightStart = '22:30', nightEnd = '07:00' } = {}) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  if (altitude != null) return altitude < -0.833;
  const t = now.getHours() * 60 + now.getMinutes(), a = mins(nightStart), b = mins(nightEnd);
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/**
 * Rain alert: "PRECIPITATION INBOUND – 20 MIN" once per wet spell, when rain is due within the hour.
 * state: null (dry) · 'inbound' (warned) · 'wet' (raining). Returns { alert: minutes|null, state }.
 */
export function rainAlert(prev, w) {
  if (!w || w.rainIn == null) return { alert: null, state: null };
  if (w.rainIn === 0) return { alert: null, state: 'wet' };
  if (w.rainIn <= 60 && !prev) return { alert: w.rainIn, state: 'inbound' };
  return { alert: null, state: prev };
}
/** Round to a tidy number of minutes for the alert (5, 10, 15…). */
export const roundMinutes = (m) => Math.max(5, Math.round(m / 5) * 5);

/** How many rain/snow particles to draw (fewer on low quality; heavier rain → more). */
export function particleCount(quality, kind, precip = 0) {
  if (!['rain', 'snow', 'storm'].includes(kind)) return 0;
  const base = { low: 250, medium: 700, high: 1600 }[quality] ?? 700;
  const heavy = Math.min(2, 0.6 + (precip || 0) / 2);
  return Math.round(base * (kind === 'snow' ? 0.7 : 1) * heavy);
}
