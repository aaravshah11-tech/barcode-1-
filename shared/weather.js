// Weather from Open-Meteo (free, no account). Pure helpers, unit tested.
// Only the rough position of your town (rounded to about 1 km) is sent to Open-Meteo.

/** WMO weather codes → plain words, and a rough kind for effects (clear, cloud, fog, rain, snow, storm). */
const CODES = {
  0: ['Clear', 'clear'], 1: ['Mostly clear', 'clear'], 2: ['Partly cloudy', 'cloud'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'], 56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm with hail', 'storm'], 99: ['Thunderstorm with hail', 'storm'],
};
export const describe = (code) => CODES[code]?.[0] || 'Unknown';
export const weatherKind = (code) => CODES[code]?.[1] || 'cloud';
const WET = new Set(['rain', 'snow', 'storm']);

/** Round a position to 2 decimal places (about 1 km) before it leaves this device. */
export const roughly = (n) => Math.round(Number(n) * 100) / 100;

export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: roughly(lat), longitude: roughly(lon),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,cloud_cover,is_day',
    hourly: 'precipitation_probability,precipitation,weather_code', forecast_hours: '6',
    minutely_15: 'precipitation', forecast_minutely_15: '8', // the next 2 hours in 15-minute steps (for rain alerts)
    daily: 'temperature_2m_max,temperature_2m_min', forecast_days: '1',
    timezone: 'auto', wind_speed_unit: 'mph',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}
export const geocodeUrl = (name) => `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: String(name).slice(0, 60), count: '5', language: 'en', format: 'json' })}`;

/** Open-Meteo's reply → what SENTINEL shows. `now` decides which hours are "coming up". */
export function parseWeather(j, now = Date.now()) {
  const c = j?.current;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('The weather service sent something unexpected.');
  const off = (Number(j.utc_offset_seconds) || 0) * 1000;
  const t = (s) => Date.parse(`${s}Z`) - off; // Open-Meteo gives local times without a zone
  const h = j.hourly || {};
  const next = (h.time || []).map((s, i) => ({ t: t(s), prob: h.precipitation_probability?.[i] ?? null, mm: h.precipitation?.[i] ?? 0, code: h.weather_code?.[i] ?? null }))
    .filter((x) => x.t + 3600000 > now).slice(0, 6);
  const wetNow = WET.has(weatherKind(c.weather_code)) || (c.precipitation || 0) > 0;
  // 15-minute steps are more precise for "rain in 20 minutes" (where the service has them)
  const m15 = (j.minutely_15?.time || []).map((s, i) => ({ t: t(s), mm: j.minutely_15.precipitation?.[i] ?? 0 })).filter((x) => x.t + 900000 > now);
  const wet15 = m15.find((x) => x.mm >= 0.1);
  const firstWet = wet15 || next.find((x) => x.mm >= 0.2 || (x.prob ?? 0) >= 60 || WET.has(weatherKind(x.code)));
  return {
    at: now, temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature ?? c.temperature_2m),
    code: c.weather_code, text: describe(c.weather_code), kind: weatherKind(c.weather_code),
    wind: Math.round(c.wind_speed_10m ?? 0), precip: c.precipitation ?? 0, cloud: c.cloud_cover ?? null, isDay: c.is_day !== 0,
    high: j.daily?.temperature_2m_max?.[0] != null ? Math.round(j.daily.temperature_2m_max[0]) : null,
    low: j.daily?.temperature_2m_min?.[0] != null ? Math.round(j.daily.temperature_2m_min[0]) : null,
    wetNow,
    /** minutes until rain/snow is expected (0 = now), or null if none in the next few hours */
    rainIn: wetNow ? 0 : firstWet ? Math.max(0, Math.round((firstWet.t - now) / 60000)) : null,
    next,
  };
}
