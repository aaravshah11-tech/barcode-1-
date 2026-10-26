// House builder: template, draw rooms (drag + click-a-shape), resize, doors/windows, floors, undo,
// floor-plan picture with scale, 3D scan import, plan on the map, and it all survives a reload.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startWorld, launch, openHQ, login, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const house = () => page.evaluate(() => window.__hq.hq.house());

  await page.click('[data-build]');
  await page.waitForSelector('.builder');
  check(true, '🏠 Build my house opens the builder');

  // Template, then undo
  await page.click('[data-template="flat"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-room]').length === 5);
  check(true, 'template “1-bed flat” draws 5 rooms');
  await shot('builder-template');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('[data-room]').length === 0);
  check(true, 'Undo (Ctrl+Z) takes it away again');

  // Draw a rectangular room by dragging
  const box = await page.locator('[data-svg]').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.click('[data-tool="rect"]');
  await page.mouse.move(cx - 200, cy - 150); await page.mouse.down(); await page.mouse.move(cx, cy, { steps: 8 }); await page.mouse.up();
  await page.waitForSelector('[data-rname]');
  await page.fill('[data-rname]', 'Kitchen'); await page.press('[data-rname]', 'Tab');
  await page.waitForFunction(() => document.querySelector('[data-room] text')?.textContent === 'Kitchen');
  check(true, 'drag to draw a room, then name it');
  await page.fill('[data-rw]', '4.5'); await page.press('[data-rw]', 'Tab');
  await page.fill('[data-rh]', '3'); await page.press('[data-rh]', 'Tab');
  await page.waitForFunction(() => document.querySelector('.b-side')?.textContent.includes('4.50 × 3.00 m'));
  check(true, 'type an exact size: 4.5 × 3 m (13.5 m²)');

  // Draw an L-shaped room by clicking corners
  await page.click('[data-fit]');
  await page.click('[data-zoom="0.8"]'); await page.click('[data-zoom="0.8"]'); await page.click('[data-zoom="0.8"]');
  const k = await page.locator('[data-room] polygon').boundingBox();
  const right = k.x + k.width;
  await page.click('[data-tool="poly"]');
  const corners = [[right + 10, k.y], [right + 160, k.y], [right + 160, k.y + 160], [right + 80, k.y + 160], [right + 80, k.y + 80], [right + 10, k.y + 80]];
  for (const [x, y] of corners) await page.mouse.click(x, y);
  await page.mouse.click(corners[0][0], corners[0][1]);
  await page.waitForFunction(() => document.querySelectorAll('[data-room]').length === 2);
  await page.fill('[data-rname]', 'Lounge'); await page.press('[data-rname]', 'Tab');
  await page.waitForFunction(() => window.__hq.hq.house().floors[0].rooms[1]?.name === 'Lounge');
  check((await house()).floors[0].rooms[1].points.length === 6, 'click corner by corner to draw an L-shaped room');

  // Doors and windows on walls
  const kitchen = await page.locator('[data-room]').first().locator('polygon').boundingBox();
  await page.click('[data-tool="door"]');
  await page.mouse.click(kitchen.x + kitchen.width / 2, kitchen.y + kitchen.height - 1);
  await page.click('[data-tool="window"]');
  await page.mouse.click(kitchen.x + kitchen.width / 2, kitchen.y + 1);
  await page.waitForFunction(() => document.querySelectorAll('.op.door').length === 1 && document.querySelectorAll('.op.window').length === 1);
  check(true, 'click on a wall to add a door and a window');
  await page.mouse.click(kitchen.x + kitchen.width / 2, kitchen.y + kitchen.height / 2);
  await page.waitForSelector('text=Click on (or very near) a wall');
  check(true, 'clicking in the middle of a room explains doors go on walls');

  // Move a room by dragging it (select tool)
  await page.click('[data-tool="select"]');
  const before = (await house()).floors[0].rooms[0].points[0];
  await page.mouse.move(kitchen.x + 30, kitchen.y + 30); await page.mouse.down(); await page.mouse.move(kitchen.x + 30, kitchen.y + 80, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const after = (await house()).floors[0].rooms[0].points[0];
  check(after[1] > before[1] && after[0] === before[0], 'drag a room to move it (doors move with it)');

  // Structure: stairs, an inner wall, a pillar; door types (no furniture)
  const k2 = await page.locator('[data-room]').first().locator('polygon').boundingBox();
  await page.click('[data-tool="stairs"]');
  await page.mouse.click(k2.x + k2.width * 0.25, k2.y + k2.height * 0.8);
  await page.waitForSelector('[data-fixture].stairs');
  await page.waitForSelector('[data-fxturn]');
  check((await page.textContent('.b-side')).includes('top floor'), 'add stairs: they say they need a floor above to lead to');
  await page.click('[data-fxturn]');
  await page.waitForFunction(() => window.__hq.hq.house().floors[0].fixtures?.[0]?.rot === 90, null, { timeout: 5000 });
  check(true, 'Turn 90° rotates the stairs');
  await page.selectOption('[data-fxkind]', 'spiral');
  await page.waitForFunction(() => window.__hq.hq.house().floors[0].fixtures[0].kind === 'spiral', null, { timeout: 5000 });
  await page.selectOption('[data-fxkind]', 'stairs');
  check(true, 'stairs can be straight or spiral');
  await page.click('[data-tool="wall"]');
  await page.mouse.move(k2.x + k2.width * 0.6, k2.y + 10); await page.mouse.down(); await page.mouse.move(k2.x + k2.width * 0.6, k2.y + k2.height - 10, { steps: 6 }); await page.mouse.up();
  await page.click('[data-tool="column"]');
  await page.mouse.click(k2.x + k2.width * 0.85, k2.y + k2.height * 0.5);
  await page.waitForFunction(() => { const f = window.__hq.hq.house().floors[0].fixtures || []; return f.length === 3 && f.some((x) => x.kind === 'wall' && x.w > 1) && f.some((x) => x.kind === 'column'); }, null, { timeout: 5000 });
  check(true, 'drag an inner wall; click to place a pillar');
  // move the stairs by dragging them
  await page.click('[data-tool="select"]');
  const sb = await page.locator('[data-fixture].stairs polygon').boundingBox();
  const sx0 = (await house()).floors[0].fixtures[0].x;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width / 2 + 40, sb.y + sb.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(800);
  check((await house()).floors[0].fixtures[0].x > sx0, 'drag the stairs to move them');
  await page.click('.op.door', { force: true });
  await page.waitForSelector('[data-okind]');
  await page.selectOption('[data-okind]', 'sliding');
  await page.waitForFunction(() => window.__hq.hq.house().floors[0].openings.some((o) => o.kind === 'sliding'), null, { timeout: 5000 });
  check(true, 'a door can become a sliding door (also archway / garage door)');
  await shot('builder-rooms');

  // Second floor
  await page.click('[data-addfloor]');
  await page.waitForFunction(() => document.querySelectorAll('[data-floor]').length === 2);
  check(await page.$$eval('.ghost:not(.stairs-below)', (g) => g.length) === 2, 'new floor: the floor below shows faintly to line rooms up');
  check(await page.$$eval('.stairs-below', (g) => g.length) === 1, 'new floor: the stairs coming up from below show, to line up the landing');
  await page.fill('[data-fname]', 'Upstairs'); await page.press('[data-fname]', 'Tab');
  await page.click('[data-tool="rect"]');
  await page.mouse.move(kitchen.x, kitchen.y + 60); await page.mouse.down(); await page.mouse.move(kitchen.x + 150, kitchen.y + 200, { steps: 6 }); await page.mouse.up();
  await page.fill('[data-rname]', 'Bedroom'); await page.press('[data-rname]', 'Tab');
  await page.waitForTimeout(800);
  const h2 = await house();
  check(h2.floors.length === 2 && h2.floors[1].name === 'Upstairs' && h2.floors[1].rooms[0].name === 'Bedroom', 'add a floor, name it, draw rooms on it');

  // Floor-plan picture: upload, set scale
  await page.click('[data-floor="0"]');
  await page.click('[data-tool="trace"]');
  await page.setInputFiles('[data-traceupload]', path.join(__dirname, '../../shared/icons/icon-512.png'));
  await page.waitForSelector('[data-trace]');
  check(true, 'upload a floor-plan picture');
  page.once('dialog', (d) => d.accept('8'));
  await page.click('[data-setscale]');
  const img = await page.locator('[data-trace]').boundingBox();
  await page.mouse.click(img.x + 5, img.y + img.height / 2);
  await page.mouse.click(img.x + img.width - 5, img.y + img.height / 2);
  await page.waitForSelector('text=Scale set');
  await page.waitForFunction(() => { const t = Object.values(window.__hq.hq.house().trace)[0]; return t && Math.abs(t.w * t.scale - 15) > 0.5; }, null, { timeout: 5000 }).catch(() => {});
  const t = (await house()).trace;
  const width = Object.values(t)[0].w * Object.values(t)[0].scale;
  check(width > 7.5 && width < 9, `set scale by clicking two points + typing the length → picture is ${width.toFixed(1)} m wide`);
  await shot('builder-trace');

  // 3D scan import
  await page.click('[data-tool="model"]');
  const glb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glb-')), 'living-room.glb');
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(28, ' '));
  const head = Buffer.alloc(20); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length, 8); head.writeUInt32LE(json.length, 12); head.write('JSON', 16);
  fs.writeFileSync(glb, Buffer.concat([head, json]));
  await page.setInputFiles('[data-modelupload]', glb);
  await page.waitForSelector('text=LOADED: living-room.glb');
  check(true, 'import a 3D scan (.glb)');
  check((await page.textContent('.b-side')).includes('Scaniverse'), 'explains which free phone apps can make a scan');
  const bad = path.join(path.dirname(glb), 'virus.exe'); fs.writeFileSync(bad, 'MZ');
  await page.setInputFiles('[data-modelupload]', bad);
  await page.waitForSelector('text=Use a .glb, .gltf, .obj or .usdz file');
  check(true, 'other file types are refused');

  // Done → the plan shows on the map panel
  await page.click('[data-done]');
  await page.waitForSelector('.builder', { state: 'detached' });
  await page.waitForFunction(() => window.__map3d?.roomMeshes.size === 3, null, { timeout: 15000 });
  check(true, 'Done: the house appears on the 3D map');
  check(await page.evaluate(() => { let n = 0; window.__map3d.root.traverse((o) => { if (o.userData.fixtureId) n++; }); return n; }) === 3, '3D map shows the stairs, inner wall and pillar');
  await page.click('[data-mapview="plan"]');
  await page.waitForSelector('[data-plan] >> text=Kitchen');
  check(true, 'Done: the floor plan shows on the Tactical map');
  await page.waitForSelector('[data-log] >> text=House plan updated: 2 floors, 3 rooms', { timeout: 5000 }).catch(() => {});
  check(await page.$$eval('[data-log] li', (l) => l.filter((x) => x.textContent.includes('House plan updated')).length) === 1, 'Mission Log notes the house plan once, when you press Done');
  await page.waitForTimeout(600);
  await shot('map-plan');

  // Survives a reload
  await page.reload();
  await login(page);
  await page.waitForFunction(() => window.__map3d?.roomMeshes.size === 3, null, { timeout: 15000 });
  await page.click('[data-build]');
  await page.click('[data-tool="trace"]');
  await page.waitForSelector('[data-trace]');
  check(true, 'after reloading: rooms, floors and the floor-plan picture are all still there');

  await finish(browser, world, errors, 'builder');
})().catch((e) => { console.error(e); process.exit(1); });
