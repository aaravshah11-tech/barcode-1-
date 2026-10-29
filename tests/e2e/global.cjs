// Part 11: GLOBAL INTEL — globe, ISS (position + next passes over HQ), airspace radar, earthquakes,
// INTEL WIRE, ship watch with Argos Atlas links, item links (#iss, #ship=…). All feeds are faked here.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, login, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

// a real ISS orbit, with its date moved to today so the maths stays accurate
function tle() {
  const d = new Date(), y = d.getUTCFullYear(), doy = (Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 0)) / 86400000;
  const epoch = `${String(y).slice(2)}${String(doy).padStart(3, '0')}.${String(Math.round(((d.getUTCHours() * 3600 + d.getUTCMinutes() * 60) / 86400) * 1e8)).padStart(8, '0')}`;
  return `ISS (ZARYA)\n1 25544U 98067A   ${epoch}  .00016717  00000-0  30030-3 0  9993\n2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560830460000\n`;
}
const OPENSKY = { states: [
  ['4ca7b5', 'RYR4KD  ', 'Ireland', 0, 0, -0.2, 51.62, 10668, false, 230, 87.5, 0, null, 10900, '7000', false, 0],
  ['406a1b', 'BAW12   ', 'United Kingdom', 0, 0, -0.45, 51.47, null, true, 5, 270, 0, null, null, '', false, 0],
  ['3c6444', 'DLH4XC  ', 'Germany', 0, 0, 0.3, 51.3, 3000, false, 140, 220, -6, null, 3100, '', false, 0],
] };
const ADSB = { ac: [{ hex: '40762f', flight: 'EZY45TM ', lat: 51.55, lon: -0.05, alt_baro: 6000, gs: 220, track: 45, t: 'A320', r: 'G-EZOA' }] };
const QUAKES = { features: [
  { id: 'us7000big', properties: { mag: 6.2, place: '120 km SW of Coquimbo, Chile', time: Date.now() - 3 * 3600000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000big', tsunami: 0 }, geometry: { coordinates: [-72.3, -30.9, 35] } },
  { id: 'ak0001', properties: { mag: 3.1, place: '50 km N of Anchorage, Alaska', time: Date.now() - 3600000 }, geometry: { coordinates: [-149.9, 61.6, 40] } },
  { id: 'jp0001', properties: { mag: 4.8, place: 'off the east coast of Honshu, Japan', time: Date.now() - 7200000 }, geometry: { coordinates: [142.5, 38.2, 20] } },
] };
const NEWS = { articles: [
  { title: 'Agency issues statement on maritime security', url: 'https://example.org/1', domain: 'example.org', seendate: '20261029T101500Z' },
  { title: 'Storm system moves across the Atlantic', url: 'https://example.org/2', domain: 'example.org', seendate: '20261029T100000Z' },
] };

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const asked = [];
  let openskyDown = false;
  await ctx.route('https://celestrak.org/**', (r) => { asked.push(r.request().url()); r.fulfill({ body: tle(), contentType: 'text/plain' }); });
  await ctx.route('https://opensky-network.org/**', (r) => { asked.push(r.request().url()); openskyDown ? r.fulfill({ status: 429, body: 'Too many requests' }) : r.fulfill({ json: OPENSKY }); });
  await ctx.route('https://api.adsb.lol/**', (r) => { asked.push(r.request().url()); r.fulfill({ json: ADSB }); });
  await ctx.route('https://earthquake.usgs.gov/**', (r) => r.fulfill({ json: QUAKES }));
  await ctx.route('https://api.gdeltproject.org/**', (r) => r.fulfill({ json: NEWS }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  await page.evaluate(() => window.__hq.api('PATCH', '/settings', { location: { name: 'London', lat: 51.51, lon: -0.13 } }));

  // ---- Open it ----
  await page.click('[data-global]');
  await page.waitForSelector('.atlas .globe-canvas');
  await page.waitForFunction(() => window.__globe?.frames > 5, null, { timeout: 15000 });
  check(true, 'Global intel opens full-screen with a 3D globe');
  await page.waitForFunction(() => window.__atlas.state.status.iss === 'live' && window.__atlas.state.status.air === 'live' && window.__atlas.state.status.quakes === 'live', null, { timeout: 15000 });
  const layers = await page.textContent('[data-layers]');
  check(/Aircraft\s*3/.test(layers) && /Earthquakes · 24 h\s*3/.test(layers) && layers.includes('Live'), 'layers: counts and LIVE status for each feed');
  const os = asked.find((u) => u.includes('opensky'));
  check(/lamin=51\.\d\d&lomin=-0\.\d\d&lamax=51\.\d\d&lomax=0\.\d\d$/.test(os), 'aircraft: only a rough box around home is sent to OpenSky');
  check(await page.evaluate(() => window.__globe.quakeGroup.children.length) >= 9, 'earthquakes pulse on the globe');
  check(await page.evaluate(() => window.__globe.issGroup.children.length) >= 4, 'the ISS and its orbit track are on the globe');

  // ---- ISS ----
  await page.fill('[data-atsearch] [name=q]', 'iss');
  await page.press('[data-atsearch] [name=q]', 'Enter');
  await page.waitForSelector('.at-card >> text=ISS (ZARYA)');
  const iss = await page.textContent('.at-card');
  const alt = Number(/Altitude\s*(\d+) km/.exec(iss)?.[1]);
  check(alt > 380 && alt < 440, `ISS card: altitude ${alt} km, speed and position`);
  check(/Next passes over London/.test(iss) && /rises [NESW]{1,2} · highest \d+° · sets/.test(iss), 'ISS card: next passes over HQ (rises, highest, sets)');
  check(await page.evaluate(() => location.hash) === '#iss', 'the address bar links to this item: #iss');
  await page.waitForTimeout(800);
  await shot('global-iss');

  // ---- Airspace ----
  check(await page.$$eval('.at-radar .ac', (a) => a.length) === 3, 'airspace radar: 3 aircraft around HQ');
  check((await page.textContent('.at-radar')).includes('FL350'), 'radar labels: callsign and flight level (FL350)');
  await page.click('[data-flights] [data-ac="4ca7b5"]');
  await page.waitForSelector('.at-card >> text=RYR4KD');
  const fl = await page.textContent('.at-card');
  check(fl.includes('FL350') && fl.includes('447 kt') && /km [NESW]{1,2}/.test(fl), 'flight card: altitude, speed, distance and direction from HQ');
  check(await page.getAttribute('.at-card a.btn-primary', 'href') === 'https://www.flightradar24.com/RYR4KD', 'flight card links to Flightradar24');
  check(await page.evaluate(() => location.hash) === '#flight=4ca7b5', 'link: #flight=…');

  // ---- Earthquakes and the INTEL WIRE ----
  const wire = await page.textContent('[data-wire]');
  check(wire.includes('M6.2 QUAKE') && wire.includes('ISS PASS') && wire.includes('maritime security'), 'INTEL WIRE: big quakes, the next ISS pass and headlines');
  await page.hover('.at-wire-track'); // hovering pauses the ticker
  await page.click('[data-wire] [data-wq="us7000big"]', { force: true });
  await page.waitForSelector('.at-card >> text=M6.2 earthquake');
  check((await page.textContent('.at-card')).includes('Coquimbo') && (await page.textContent('.at-card')).includes('35 km'), 'quake card: place, time, depth, distance from HQ');

  // ---- Ships (Argos Atlas) ----
  await page.fill('[data-addship] [name=mmsi]', '23505212');
  await page.click('[data-addship] button');
  await page.waitForSelector('text=An MMSI is 9 digits');
  check(true, 'a wrong MMSI is explained');
  await page.fill('[data-addship] [name=mmsi]', '235052123');
  await page.fill('[data-addship] [name=name]', 'Test vessel');
  await page.click('[data-addship] button');
  await page.waitForSelector('.at-card >> text=Test vessel');
  check((await page.textContent('.at-card')).includes('United Kingdom'), 'ship card: MMSI and flag (235 = United Kingdom)');
  check(await page.getAttribute('.at-card a.btn-primary', 'href') === 'https://argosatlas.com/map/#ship=235052123', 'ship card: “Open live position in Argos Atlas” → argosatlas.com/map/#ship=235052123');
  check(await page.evaluate(() => location.hash) === '#ship=235052123', 'link: #ship=235052123 (same style as Argos Atlas)');
  check(await page.evaluate(() => window.__hq.hq.settings().ships[0]?.mmsi) === '235052123', 'the watch list is kept by HQ (so your phone sees it too)');
  await shot('global-ship');

  // ---- A feed fails: back-up source ----
  openskyDown = true;
  await page.evaluate(() => window.__atlas.reload());
  await page.waitForFunction(() => window.__atlas.state.aircraft[0]?.src === 'adsb.lol');
  check(await page.$$eval('.at-radar .ac', (a) => a.length) === 1, 'OpenSky busy (429): planes come from adsb.lol instead');

  // ---- Close, and open straight from a link ----
  await page.keyboard.press('Escape');
  await page.waitForSelector('.atlas', { state: 'detached' });
  check(await page.evaluate(() => location.hash) === '', 'Esc closes it');
  await page.evaluate(() => { location.hash = '#iss'; });
  await page.waitForSelector('.atlas .at-card >> text=ISS (ZARYA)', { timeout: 15000 });
  check(true, 'pasting a link (#iss) while HQ is open jumps to it');
  await page.keyboard.press('Escape');
  await page.goto('about:blank');
  await page.goto(`${world.hqUrl}#ship=235052123`);
  await login(page);
  await page.waitForSelector('.atlas .at-card >> text=Test vessel', { timeout: 15000 });
  check(true, 'opening HQ with #ship=235052123 goes straight to that ship');
  await page.keyboard.press('Escape');

  // ---- Terminal / voice ----
  await page.click('.p-log .panel-head h2');
  await page.keyboard.press('Backquote');
  await page.fill('[data-termin]', 'where is the iss'); await page.press('[data-termin]', 'Enter');
  await page.waitForSelector('.atlas');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => /The ISS is \d+ km up/.test(document.querySelector('[data-termout]')?.textContent || ''), null, { timeout: 15000 });
  check(true, 'terminal/voice: “where is the ISS?” answers with height and next pass');

  await finish(browser, world, errors, 'global intel');
})().catch((e) => { console.error(e); process.exit(1); });
