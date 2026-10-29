// Part 10: LIVE WORLD — real sun + shadow on the 3D map, compass, night vision after sunset, rain/snow and
// cloud shadows, the PRECIPITATION INBOUND alert, and CINEMATIC idle mode. The weather service is faked.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
let raining = false;
function forecast() {
  const now = Date.now(), q = Math.floor(now / 900000) * 900000, h = Math.floor(now / 3600000) * 3600000;
  return {
    utc_offset_seconds: 0,
    current: raining ? { temperature_2m: 9, apparent_temperature: 7, weather_code: 63, wind_speed_10m: 18, precipitation: 1.4, cloud_cover: 100, is_day: 1 }
      : { temperature_2m: 12, apparent_temperature: 10, weather_code: 3, wind_speed_10m: 10, precipitation: 0, cloud_cover: 90, is_day: 1 },
    minutely_15: { time: [0, 1, 2, 3].map((k) => iso(new Date(q + k * 900000))), precipitation: raining ? [1, 1, 1, 1] : [0, 0, 0.6, 1.2] },
    hourly: { time: [0, 1, 2].map((k) => iso(new Date(h + k * 3600000))), precipitation_probability: [20, 90, 90], precipitation: [0, 2, 2], weather_code: [3, 63, 63] },
    daily: { temperature_2m_max: [13], temperature_2m_min: [6] },
  };
}

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: forecast() }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);

  // A house, a location (London), the 3D map
  await page.evaluate(async () => {
    const { TEMPLATES } = await import(new URL('../shared/house.js', location.href).href);
    await window.__hq.api('PUT', '/house', TEMPLATES.house.make());
    await window.__hq.api('PATCH', '/settings', { location: { name: 'London', lat: 51.51, lon: -0.13 } });
  });
  await page.click('[data-mapview="3d"]');
  await page.waitForFunction(() => window.__map3d?.roomMeshes.size === 9, null, { timeout: 15000 });

  // ---- Rain alert ----
  await page.waitForSelector('[data-log] >> text=/PRECIPITATION INBOUND – \\d+ MIN · London/', { timeout: 15000 });
  check(true, 'rain due in the next half hour → “PRECIPITATION INBOUND – nn MIN · London” in the Mission Log');
  await page.evaluate(() => window.__hq.hq.refreshWeather());
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__hq.hq.db.events({ limit: 200 }).filter((e) => /INBOUND/.test(e.message)).length) === 1, 'only once per wet spell');

  // ---- Daytime: sun, shadow, compass ----
  const noon = await page.evaluate(() => { const d = new Date(); d.setHours(12, 30, 0, 0); return window.__world._setNow(d.getTime()); });
  check(noon.phase === 'day' && !noon.nv, `12:30 in London: daylight, sun ${noon.sun.altitude}° up`);
  const m1 = await page.evaluate(() => { const m = window.__map3d; return { sun: !!m.sunObj, shadow: !!m.shadowMesh, compass: m.compass && [m.compass.position.x, m.compass.position.z] }; });
  check(m1.sun && m1.shadow, 'the sun is shown where it really is, and the house casts a shadow');
  check((await page.textContent('[data-worldchip]')).includes('Daylight · sun'), 'map chip: “Daylight · sun nn°”');
  await page.waitForTimeout(600);
  await shot('world-day');
  // Shadow direction: at midday the sun is south, so the shadow lies north (up the plan = smaller z)
  const sh = await page.evaluate(() => { const m = window.__map3d; return { shadowZ: m.shadowMesh.position.z, houseZ: m.center.z }; });
  check(sh.shadowZ < sh.houseZ, 'at midday the shadow falls north (the sun is in the south)');
  // Tell HQ the top of the plan faces east → the compass N moves
  await page.click('[data-settings]');
  await page.selectOption('[data-north]', '90');
  await page.waitForFunction(() => window.__hq.hq.settings().northDeg === 90);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const d = new Date(); d.setHours(12, 30, 0, 0); return window.__world._setNow(d.getTime()); });
  const m2 = await page.evaluate(() => [window.__map3d.compass.position.x, window.__map3d.compass.position.z]);
  check(Math.abs(m2[0] - m1.compass[0]) > 1, 'Settings: “top of my floor plan faces East” turns the compass (and the shadows)');

  // ---- Night: night vision ----
  const night = await page.evaluate(() => { const d = new Date(); d.setHours(23, 30, 0, 0); return window.__world._setNow(d.getTime()); });
  check(night.nv && night.phase === 'night', '23:30: night, night vision switches on by itself');
  check(await page.evaluate(() => document.querySelector('[data-map3d]').classList.contains('nv') && window.__map3d.c.accent.getHexString() === '52ff8f'), 'night vision: the map turns phosphor green');
  check(await page.evaluate(() => !window.__map3d.sunObj && !window.__map3d.shadowMesh), 'no sun or shadow at night');
  check((await page.textContent('[data-worldchip]')).toUpperCase().includes('NIGHT VISION'), 'map chip: NIGHT VISION');
  await page.waitForTimeout(600);
  await shot('world-night');
  await page.click('[data-settings]');
  await page.selectOption('[data-nv]', 'off');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-map3d]').classList.contains('nv'));
  check(true, 'night vision can be switched off (this device)');
  await page.evaluate(() => { localStorage.removeItem('sentinel.world'); window.__world._setNow(null); });

  // ---- Weather on the map ----
  raining = true;
  await page.evaluate(() => window.__hq.hq.refreshWeather());
  await page.evaluate(() => { const d = new Date(); d.setHours(12, 30, 0, 0); return window.__world._setNow(d.getTime()); });
  await page.waitForFunction(() => window.__map3d.rain?.pts.geometry.attributes.position.count > 100);
  const y0 = await page.evaluate(() => window.__map3d.rain.pts.geometry.attributes.position.array[1]);
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => window.__map3d.rain.pts.geometry.attributes.position.array[1]);
  check(y0 !== y1, 'raining now: rain falls over the house');
  check(await page.evaluate(() => window.__map3d.clouds.length) >= 3, 'overcast: cloud shadows drift across');
  check((await page.textContent('[data-worldchip]')).includes('Rain'), 'map chip says Rain');
  await shot('world-rain');
  await page.click('[data-settings]');
  await page.uncheck('[data-weatherfx]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__map3d.rain && !window.__map3d.clouds.length);
  check(true, 'weather effects can be switched off for a slow laptop');
  await page.evaluate(() => { localStorage.removeItem('sentinel.world'); window.__world._setNow(null); });

  // ---- Cinematic idle mode ----
  await page.click('[data-mapview="plan"]');
  await page.evaluate(() => window.__world._idleFor(6 * 60000)); // nobody has touched HQ for 6 minutes
  await page.waitForFunction(() => document.body.classList.contains('cinematic'), null, { timeout: 12000 });
  check(true, 'after 5 minutes untouched: cinematic mode starts');
  check(await page.evaluate(() => window.__map3d && !!window.__map3d.cine), 'it switches to the 3D map and the camera circles the house');
  const a0 = await page.evaluate(() => window.__map3d.camera.position.x);
  await page.waitForTimeout(800);
  check(Math.abs(await page.evaluate(() => window.__map3d.camera.position.x) - a0) > 0.01, 'the camera is moving');
  check(await page.isVisible('[data-cinecap]') && await page.$$eval('.cine-focus', (x) => x.length) === 1, 'intel lines under the map, panels highlighted in turn');
  await shot('world-cinematic');
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => !document.body.classList.contains('cinematic'));
  await page.waitForFunction(() => !document.querySelector('[data-plan]').hidden);
  check(true, 'any key ends it and puts the plan view back');

  // ---- Terminal ----
  await page.click('.p-log .panel-head h2');
  await page.keyboard.press('Backquote');
  await page.fill('[data-termin]', 'nightvision on'); await page.press('[data-termin]', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-termout]').textContent.includes('Night vision on'));
  check(await page.evaluate(() => window.__world.state.nv), 'terminal: nightvision on');
  await page.fill('[data-termin]', 'nightvision auto'); await page.press('[data-termin]', 'Enter');
  await page.fill('[data-termin]', 'cinematic'); await page.press('[data-termin]', 'Enter');
  await page.waitForFunction(() => document.body.classList.contains('cinematic'), null, { timeout: 5000 });
  check(true, 'terminal: cinematic');
  await page.mouse.click(10, 10);
  await page.waitForFunction(() => !document.body.classList.contains('cinematic'));

  await finish(browser, world, errors, 'live world');
})().catch((e) => { console.error(e); process.exit(1); });
