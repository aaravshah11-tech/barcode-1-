// 3D map: the house in 3D, floors, explode, placing Agents (button + drag), live room glow, fly-to, quality.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, hqApi, check, finish } = require('./helpers.cjs');
const video = require('./video.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium, [`--use-file-for-fake-video-capture=${video.moving()}`]);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  const map = (fn, arg) => page.evaluate(fn, arg);

  // A 2-floor house (from the template) and two Agents
  await page.evaluate(async () => { const { TEMPLATES } = await import(new URL('../shared/house.js', location.href).href); await window.__hq.api('PUT', '/house', TEMPLATES.house.make()); });
  const phone = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const cam = await recruit(page, await phone(), world);
  const ear = await recruit(page, await phone(), world);
  await page.reload();
  await require('./helpers.cjs').login(page);
  await page.waitForFunction(() => window.__map3d?.roomMeshes.size === 9, null, { timeout: 20000 });
  check(true, 'with a house plan, the Tactical map opens in 3D: 9 rooms on 2 floors');
  check(await map(() => window.__map3d.openingLines.length) >= 14, 'doors and windows are drawn on the walls');

  // Floors and explode
  await page.click('[data-floor3d="0"]');
  check(await map(() => !window.__map3d.floorGroups[1].visible && window.__map3d.floorGroups[0].visible), 'Ground floor button hides the floor above');
  await page.click('[data-floor3d="-1"]');
  await page.click('[data-explode]');
  await page.waitForFunction(() => window.__map3d.explode > 0.95);
  check(await map(() => window.__map3d.floorGroups[1].position.y > 5), 'Explode pulls the floors apart');
  await page.waitForTimeout(500);
  await shot('map3d-explode');
  await page.click('[data-explode]');
  await page.waitForFunction(() => window.__map3d.explode < 0.05);

  // Place an Agent with the drawer button + a click on the map
  await page.click(`[data-agent="${cam.id}"]`);
  check((await page.textContent('.drawer-grid')).includes('Not positioned'), 'Agent drawer says it isn’t on the map yet');
  await page.click('[data-place]');
  await page.waitForSelector('[data-maphint]:not([hidden])');
  await page.click('[data-floor3d="0"]');
  const room = await map(() => { const m = window.__map3d; const r = m.house.floors[0].rooms[0]; const c = [r.points[0][0] + 1.5, r.points[0][1] + 1.5]; const v = new (m.camera.position.constructor)(c[0], 0, c[1]).project(m.camera); const box = m.renderer.domElement.getBoundingClientRect(); return { name: r.name, x: box.left + (v.x + 1) / 2 * box.width, y: box.top + (1 - v.y) / 2 * box.height }; });
  await page.mouse.click(room.x, room.y);
  await page.waitForFunction((id) => window.__hq.db.agent(id)?.place?.roomId, cam.id);
  const placed = await page.evaluate((id) => window.__hq.db.agent(id).place, cam.id);
  const roomName = await page.evaluate((p) => window.__hq.hq.house().floors[0].rooms.find((r) => r.id === p.roomId).name, placed);
  check(roomName === room.name, `📍 Place on map + click: Agent placed in the ${roomName}`);
  await page.waitForFunction(() => window.__map3d.markers.size === 1);
  check(await page.waitForSelector(`[data-log] >> text=placed in ${room.name}`, { timeout: 5000 }).then(() => true, () => false), 'Mission Log: “placed in …”');

  // Drag the other Agent's card onto the map
  const kit = await map(() => { const m = window.__map3d; const r = m.house.floors[0].rooms.find((x) => x.name === 'Kitchen'); const xs = r.points.map((p) => p[0]), ys = r.points.map((p) => p[1]); const v = new (m.camera.position.constructor)((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...ys) + Math.max(...ys)) / 2).project(m.camera); const box = m.renderer.domElement.getBoundingClientRect(); return { x: (v.x + 1) / 2 * box.width, y: (1 - v.y) / 2 * box.height }; });
  await page.dragAndDrop(`[data-agent="${ear.id}"]`, '[data-map3d]', { targetPosition: kit });
  await page.waitForFunction((id) => window.__hq.db.agent(id)?.place, ear.id, { timeout: 5000 }).catch(() => {});
  const p2 = await page.evaluate((id) => window.__hq.db.agent(id)?.place, ear.id);
  const r2 = p2 && await page.evaluate((p) => window.__hq.hq.house().floors[0].rooms.find((r) => r.id === p.roomId)?.name, p2);
  check(r2 === 'Kitchen', `drag an Agent card onto the map → placed in the ${r2}`);
  await page.waitForFunction(() => window.__map3d.markers.size === 2);

  // Live events: motion lights up the room
  await api('PATCH', `/agents/${cam.id}`, { mission: 'motion', settings: { cooldown: 5 } });
  await page.waitForFunction(() => window.__map3d.effects.some((e) => e.kind === 'room'), null, { timeout: 25000 });
  check(true, 'motion detected → the room glows on the 3D map');
  await page.waitForTimeout(300);
  await shot('map3d-motion');
  await page.evaluate((id) => window.__map3d.event({ agentId: id, kind: 'sound', level: 'info', message: 'Loud sound: 80 dB' }), ear.id);
  check(await map(() => window.__map3d.effects.filter((e) => e.kind === 'ripple').length === 3), 'loud sound → ripple rings spread out from the Agent');

  // Fly-to from the Mission Log
  const before = await map(() => window.__map3d.camera.position.toArray());
  await page.click(`[data-log] li[data-evagent="${cam.id}"]`);
  check(await map(() => !!window.__map3d.flight), 'clicking a Mission Log entry flies the camera to that room');
  await page.waitForFunction(() => !window.__map3d.flight, null, { timeout: 5000 });
  const after = await map(() => window.__map3d.camera.position.toArray());
  check(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) > 1, 'the camera moved');

  // Clicking a marker opens that Agent
  await page.click('[data-fit3d]');
  await page.waitForTimeout(400);
  const mk = await map((id) => { const m = window.__map3d; const pin = m.markers.get(id).children[0]; const v = pin.getWorldPosition(new (m.camera.position.constructor)()).project(m.camera); const box = m.renderer.domElement.getBoundingClientRect(); return { x: box.left + (v.x + 1) / 2 * box.width, y: box.top + (1 - v.y) / 2 * box.height }; }, ear.id);
  await page.mouse.click(mk.x, mk.y);
  await page.waitForSelector('.drawer-grid');
  check((await page.textContent('.drawer-grid')).includes('Kitchen · Ground floor'), 'clicking an Agent marker opens it (Location: Kitchen · Ground floor)');
  await page.keyboard.press('Escape');

  // Quality setting for older laptops
  await page.click('[data-settings]');
  await page.selectOption('[data-q3d]', 'low');
  check(await map(() => window.__map3d.qName === 'low' && window.__map3d.q.fps === 24), '3D quality “Low” for older laptops');
  await page.keyboard.press('Escape');

  // The other views still work
  await page.click('[data-mapview="plan"]');
  await page.waitForSelector('[data-plan] >> text=Kitchen');
  await page.click('[data-mapview="radar"]');
  check(await page.isVisible('[data-radar]'), 'Plan and Radar views still available');

  await finish(browser, world, errors, '3D map');
})().catch((e) => { console.error(e); process.exit(1); });
