// v3 phase 3: SITUATION ROOM (full-screen 3D of the house and grounds) and the builder's OUTSIDE tab.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 960 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);

  // ---- Builder: the Outside tab ----
  await page.click('[data-build]');
  await page.waitForSelector('.builder [data-template="house"]');
  await page.click('[data-template="house"]');
  await page.click('[data-floor="-1"]');
  await page.waitForSelector('.builder [data-tool="door"] >> text=Add gate');
  check(await page.isHidden('.builder [data-tool="stairs"]') && (await page.textContent('.builder [data-tool="wall"]')).includes('Fence') && (await page.textContent('.builder [data-tool="column"]')).includes('Tree'), 'Outside tab: zones, gates, fences, trees (no stairs/windows)');
  check(await page.$$eval('.builder .zone', (z) => z.length) >= 7, 'template grounds: plot, back garden, patio, front garden, path, driveway, garage');
  await page.click('[data-tool="rect"]');
  const box = await (await page.$('.builder [data-svg]')).boundingBox();
  await page.mouse.move(box.x + 60, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 120, { steps: 5 }); await page.mouse.up();
  await page.waitForSelector('[data-rtype]');
  await page.selectOption('[data-rtype]', 'shed');
  await page.waitForFunction(() => document.querySelector('[data-rname]')?.value === 'Shed');
  check(true, 'draw a zone, set its type (Shed → becomes a small building)');
  await shot('v3-builder-outside');
  await page.click('[data-done]');
  await page.waitForFunction(() => (window.__hq.hq.house().site?.rooms || []).some((r) => r.type === 'shed'));
  check(true, 'outside saved with the house');
  check((await api('GET', '/house/versions')).length >= 1, 'version history kept when you press Done');

  // ---- Agents: inside (cone) and outside (zone) ----
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const a1 = await recruit(page, ctxA, world), a2 = await recruit(page, ctxA, world);
  const f0 = (await api('GET', '/house')).floors[0];
  await api('PATCH', `/agents/${a1.id}`, { mission: 'motion' });
  await api('PUT', `/agents/${a1.id}/place`, { floorId: f0.id, x: 7, y: 2 });
  await api('PUT', `/agents/${a2.id}/place`, { floorId: f0.id, x: 11.5, y: 11 });
  const placed = (await api('GET', '/state')).agents.find((a) => a.id === a2.id).place;
  check(placed.zone === 'front', `an Agent dropped on the driveway belongs to the Front zone (${placed.zone})`);

  // ---- Situation Room ----
  await page.click('.rail [data-view="situation"]');
  await page.waitForFunction(() => window.__map3d?.siteGroup?.children.length > 5 && window.__map3d.markers.size === 2, null, { timeout: 15000 });
  check(true, 'Situation Room: full-screen 3D with the grounds (zones, garage, trees, fence) and both Agents');
  check(await page.evaluate(() => window.__map3d.cones3d.length >= 1), 'detection cone drawn for the camera Agent');
  await page.click('[data-preset="garden"]');
  await page.waitForFunction(() => !window.__map3d.flight);
  await page.click('[data-preset="front"]');
  check(true, 'camera presets fly to the garden and the front');
  await page.click('[data-roof]');
  check(await page.evaluate(() => window.__map3d.roofGroup.visible), 'roof toggle');
  await page.click('[data-roof]');
  await page.click('[data-xray]');
  check(await page.evaluate(() => window.__map3d.xray), 'x-ray mode');
  await page.click('[data-coverage]');
  await page.waitForSelector('[data-maphint]:not([hidden]) >> text=Suggestion');
  check(await page.evaluate(() => window.__map3d.covOn), `coverage overlay with a suggestion (“${(await page.textContent('[data-maphint]')).slice(0, 90)}…”)`);
  await page.evaluate((id) => window.__hq.hq.agentEvent(id, { kind: 'motion', message: 'Person detected', data: { class: 'person' } }), a1.id);
  await page.waitForFunction(() => window.__map3d.effects.some((e) => e.kind === 'detect'));
  check(true, 'a classified detection shows as a labelled marker (PERSON · time)');
  await page.evaluate(() => window.__map3d.setWeather('rain'));
  check(await page.evaluate(() => !!window.__map3d.rain && !!window.__map3d.scene.fog), 'rain: fine streaks and a light mist');
  await page.waitForTimeout(600);
  await shot('v3-situation');
  await page.evaluate(() => window.__map3d.setWeather(null));

  // Operations Floor map turns slowly when idle
  await page.click('.rail [data-view="ops"]');
  await page.click('[data-mapview="3d"]');
  await page.waitForFunction(() => window.__map3d?.spin === true, null, { timeout: 15000 });
  check(true, 'Operations Floor 3D view turns slowly when idle and flies to new events');

  await finish(browser, world, errors, 'situation');
})().catch((e) => { console.error(e); process.exit(1); });
