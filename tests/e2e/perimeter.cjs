// v3 phase 6: the Perimeter screen — zone cards, front-door visits, garage left open, weather station.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, hqApi, check, finish, go } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);

  await page.evaluate(() => {
    const hq = window.__hq.hq, M = 60000, now = Date.now();
    const person = (min, zone = 'front') => hq.logEvent({ ts: now - min * M, kind: 'perimeter', message: `Person detected (${zone})`, data: { class: 'person', zone } });
    person(50); person(49); hq.logEvent({ ts: now - 48 * M, kind: 'door', message: 'Hall door: Door opened' }); // a visitor, let in
    person(20); // a quick call, nobody answered
    hq.logEvent({ ts: now - 10 * M, kind: 'perimeter', message: 'Vehicle detected (front / driveway)', data: { class: 'vehicle', zone: 'front' } });
    hq.logEvent({ ts: now - 5 * M, kind: 'perimeter', message: 'Animal detected (garden)', data: { class: 'animal', zone: 'garden' } });
  });
  await api('PATCH', '/settings', { location: { name: 'Testville', lat: 51.5, lon: -0.12 } });
  await page.evaluate(() => {
    const hq = window.__hq.hq, now = Date.now();
    hq.weather = { at: now, place: 'Testville', temp: 9, feels: 6, text: 'Overcast', kind: 'cloud', wind: 28, gust: 44, windDir: 230, humidity: 81, high: 11, low: 5, rainIn: 35, rainToday: 2.4,
      hours: Array.from({ length: 12 }, (_, i) => ({ t: now + i * 3600000, temp: 9 + (i % 3), prob: i * 8, mm: 0 })), next: [] };
    hq.broadcast({ t: 'weather', weather: hq.weather });
  });

  await page.click('.rail [data-view="perimeter"]');
  await page.waitForSelector('[data-pzone="front"]');
  const front = await page.textContent('[data-pzone="front"]');
  check(/3\s*People/.test(front) && /1\s*Vehicles/.test(front), `front zone card counts people and vehicles today`);
  check(/1\s*Animals/.test(await page.textContent('[data-pzone="garden"]')), 'garden card counts the animal');
  check(/NO AGENT/.test(front), 'a zone with no Agent says so');
  const visits = await page.textContent('[data-pvisits]');
  check(visits.includes('Visitor') && visits.includes('door answered'), 'front-door visit: Visitor, door answered');
  check(visits.includes('Possible delivery or passer-by'), 'front-door visit: possible delivery or passer-by');
  const wx = await page.textContent('[data-pwx]');
  check(/9°/.test(wx) && /28 mph SW · gusts 44/.test(wx) && /in ~35 min/.test(wx) && /81%/.test(wx), 'weather station: temperature, wind with direction and gusts, rain due, humidity');
  check(/↑ \d\d:\d\d · ↓ \d\d:\d\d/.test(wx), 'sunrise and sunset');
  check(await page.locator('.wx-hours > div').count() === 12, '12-hour outlook');
  check(/Windy: outside movement is graded down/.test(wx), 'wind warning ties in with alert grading');
  check(/Met Office/.test(wx), 'Met Office warnings link');
  await page.waitForFunction(() => !/Loading rain radar/.test(document.querySelector('[data-radar]').textContent), null, { timeout: 20000 });
  check(true, `rain radar loads or says it is unavailable (${(await page.textContent('[data-radar]')).trim().slice(0, 40)})`);
  await page.selectOption('[name=garageOpenMin]', '30');
  await page.waitForFunction(async () => (await window.__hq.api('GET', '/state')).settings.garageOpenMin === 30);
  check(true, 'garage open warning time saved');
  await shot('hq-perimeter');
  check(await page.evaluate(() => document.querySelector('.rail [data-view="perimeter"]') && [...document.querySelectorAll('.rail [data-view]')].map((b) => b.dataset.view).indexOf('perimeter') === 4), 'Perimeter is 5th in the rail (after Casework)');

  await finish(browser, world, errors, 'perimeter');
})().catch((e) => { console.error(e); process.exit(1); });
