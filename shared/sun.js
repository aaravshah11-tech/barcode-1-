// Where the sun is, and when it rises and sets (NOAA's formulas). Pure, works offline, unit tested.
// lat/lon in degrees (north and east positive). Times are milliseconds since 1970 (UTC).
const RAD = Math.PI / 180, DAY = 86400000;
const julian = (ms) => ms / DAY + 2440587.5;

function solar(ms) {
  const t = (julian(ms) - 2451545) / 36525; // Julian centuries since J2000
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * t) * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD)); // minutes
  return { decl, eqTime };
}

/** Sun's height above the horizon and compass direction, in degrees. */
export function sunPosition(ms, lat, lon) {
  const { decl, eqTime } = solar(ms);
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const tst = (minutes + eqTime + 4 * lon + 1440) % 1440; // true solar time
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180; // hour angle
  const cosZ = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ))) / RAD;
  const az = (Math.atan2(Math.sin(ha * RAD), Math.cos(ha * RAD) * Math.sin(lat * RAD) - Math.tan(decl * RAD) * Math.cos(lat * RAD)) / RAD + 180 + 360) % 360;
  return { altitude: 90 - zenith, azimuth: az };
}

/**
 * Sunrise, sunset and solar noon for the day that contains `ms` (that day in UTC, near the place's
 * own day for most of the world). polar = 'day' (sun never sets) or 'night' (never rises) near the poles.
 */
export function sunTimes(ms, lat, lon) {
  const day0 = Math.floor(ms / DAY) * DAY; // UTC midnight
  // iterate once so the sun's position is taken at (roughly) the right moment
  let noon = day0 + (720 - 4 * lon) * 60000;
  noon = day0 + (720 - 4 * lon - solar(noon).eqTime) * 60000;
  const { decl } = solar(noon);
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
  if (cosH < -1) return { sunrise: null, sunset: null, noon, polar: 'day' };
  if (cosH > 1) return { sunrise: null, sunset: null, noon, polar: 'night' };
  const half = (Math.acos(cosH) / RAD) * 4 * 60000;
  return { sunrise: noon - half, sunset: noon + half, noon, polar: null };
}

/** Is it dark (sun below the horizon) at this moment? */
export const isDark = (ms, lat, lon) => sunPosition(ms, lat, lon).altitude < -0.833;
