// Part 9: REPLAY (today's sensor events played back on the 3D map and the plan) and HEATMAP (busiest rooms).
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);

  // Without a floor plan it explains what's needed
  await page.click('[data-replay]');
  await page.waitForSelector('text=Draw your floor plan first');
  check(true, 'no floor plan yet: Replay explains you need to draw one');

  // A 2-floor house with two Agents placed in it
  await page.evaluate(async () => {
    const { TEMPLATES } = await import(new URL('../shared/house.js', location.href).href);
    await window.__hq.api('PUT', '/house', TEMPLATES.house.make());
  });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const kitchen = await recruit(page, ctxA, world);
  const hall = await recruit(page, ctxA, world);
  const f0 = (await api('GET', '/house')).floors[0];
  const roomId = (name) => f0.rooms.find((r) => r.name === name).id;
  await api('PUT', `/agents/${kitchen.id}/place`, { floorId: f0.id, x: 7, y: 2 });
  await api('PUT', `/agents/${hall.id}/place`, { floorId: f0.id, x: 1.5, y: 6 });

  // Earlier today: 6 events in the kitchen (one an alert), 2 in the hall
  await page.evaluate(({ k, h }) => {
    const db = window.__hq.hq.db, now = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const at = (min) => Math.max(d0.getTime() + 60000, now - min * 60000);
    [50, 45, 40, 35, 30].forEach((m) => db.addEvent({ ts: at(m), kind: 'motion', agentId: k, message: 'AGENT-01: motion detected' }));
    db.addEvent({ ts: at(25), kind: 'motion', agentId: k, level: 'alert', message: 'AGENT-01: motion detected' });
    [20, 10].forEach((m) => db.addEvent({ ts: at(m), kind: 'door', agentId: h, message: 'AGENT-02: door opened' }));
  }, { k: kitchen.id, h: hall.id });

  // ---- Heatmap on the 3D map ----
  await page.click('[data-mapview="3d"]');
  await page.waitForFunction(() => window.__map3d?.roomMeshes.size === 9, null, { timeout: 15000 });
  await page.click('[data-heat]');
  await page.waitForSelector('[data-heatlegend]:not([hidden]) >> text=Busiest rooms');
  const op = await page.evaluate(({ k, h }) => { const m = window.__map3d.roomMeshes; return { k: m.get(k).userData.floorMesh.material.color.r, h: m.get(h).userData.floorMesh.material.color.r, other: [...m.values()][0].userData.floorMesh.material.color.r }; }, { k: roomId('Kitchen'), h: roomId('Hall') });
  check(op.k > op.h && op.h > op.other, `3D: the kitchen (6 events) is tinted most amber, the hall (2) less, quiet rooms not at all (${op.k.toFixed(2)} > ${op.h.toFixed(2)} > ${op.other.toFixed(2)})`);
  check((await page.textContent('[data-heatlegend]')).includes('8 sensor events'), 'legend: period, scale from fewer to more, total events');
  await shot('heatmap-3d');

  // ---- …and on the plan, with counts and a read-out when pointing at a room ----
  await page.click('[data-mapview="plan"]');
  await page.waitForSelector(`[data-proom="${roomId('Kitchen')}"] .heat-n`);
  const n = await page.$$eval('[data-plan] .heat-n', (t) => t.map((x) => x.textContent));
  check(n.includes('6') && n.includes('2'), 'plan: each room shows its count');
  const kb = await page.locator(`[data-proom="${roomId('Kitchen')}"] polygon`).boundingBox();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 3);
  await page.waitForSelector('[data-maptip]:not([hidden])');
  check((await page.textContent('[data-maptip]')) === 'Kitchen · 6 events', 'pointing at a room: “Kitchen · 6 events”');
  // a new event while it's on counts straight away
  await page.evaluate((k) => window.__hq.hq.logEvent({ kind: 'motion', agentId: k, message: 'AGENT-01: motion detected' }), kitchen.id);
  await page.waitForFunction((id) => document.querySelector(`[data-proom="${id}"] .heat-n`)?.textContent === '7', roomId('Kitchen'));
  check(true, 'live: a new kitchen event makes it 7');
  await page.click('[data-heatdays="7"]');
  await page.waitForSelector('[data-heatlegend] >> text=Last 7 days');
  check(true, 'heatmap period: today or the last 7 days');
  await shot('heatmap-plan');

  // ---- Replay on the plan ----
  await page.evaluate(() => {
    window.__flashes = 0;
    new MutationObserver((ms) => ms.forEach((m) => { if (m.target.classList?.contains('hit') || m.target.classList?.contains('hit-alert')) window.__flashes++; })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.click('[data-replay]');
  await page.waitForSelector('[data-replaybar]:not([hidden]) [data-rpseek]');
  check(await page.$$eval('.rp-ticks i', (t) => t.length) >= 8 && await page.$$eval('.rp-ticks i.alert', (t) => t.length) === 1, 'replay bar: one tick per event, the alert in red');
  check((await page.textContent('[data-replaybar]')).includes('/ 9 events'), 'replay shows how many events the day had');
  await page.click('[data-rpspeed="3600"]');
  await page.waitForFunction(() => window.__timeline.state?.idx === 9 && !window.__timeline.state.playing, null, { timeout: 30000 });
  check(true, 'at 1 h/s it plays through all 9 events and stops at the end');
  check(await page.evaluate(() => window.__flashes) >= 3, 'rooms flash on the plan as each event plays');
  check(/MOTION · Kitchen/.test(await page.textContent('[data-rpfeed]')), 'the bar lists what just happened: “MOTION · Kitchen”');
  check((await page.textContent('[data-heatlegend]')).includes('Replay so far'), 'heatmap builds up during the replay');
  await shot('replay-plan');

  // Drag the slider back to the start
  await page.evaluate(() => { const s = document.querySelector('[data-rpseek]'); s.value = s.min; s.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await page.evaluate(() => window.__timeline.state.idx) === 0, 'dragging the slider jumps in time');

  // ---- Replay on the 3D map ----
  await page.click('[data-mapview="3d"]');
  await page.waitForFunction(() => window.__map3d?.roomMeshes.size === 9, null, { timeout: 15000 });
  await page.waitForSelector('[data-replaybar]:not([hidden])');
  await page.evaluate(() => { window.__fired = 0; const m = window.__map3d, orig = m.event.bind(m); m.event = (ev) => { window.__fired++; orig(ev); }; });
  await page.click('[data-rpplay]');
  await page.waitForFunction(() => window.__timeline.state?.idx === 9, null, { timeout: 30000 });
  check(await page.evaluate(() => window.__fired) >= 8, '3D: each event lights up its room as it plays');
  await page.click('[data-rpday="1"]');
  await page.waitForSelector('[data-replaybar] >> text=No sensor events on this day');
  check(true, 'Yesterday: says there was nothing to replay');
  await shot('replay-3d');
  await page.click('[data-rpexit]');
  await page.waitForSelector('[data-replaybar]', { state: 'hidden' });
  check(true, 'Exit: back to live');

  // ---- Terminal ----
  await page.click('.wp-log .panel-head h2');
  await page.keyboard.press('Backquote');
  const run = async (cmd, want) => { await page.fill('[data-termin]', cmd); await page.press('[data-termin]', 'Enter'); await page.waitForFunction((w) => document.querySelector('[data-termout]').textContent.includes(w), want, { timeout: 10000 }); };
  await run('replay today', 'Replaying today');
  check(await page.isVisible('[data-replaybar]'), 'terminal: replay today');
  await run('replay stop', 'Back to live');
  await run('heatmap', 'Busiest: Kitchen');
  check(true, 'terminal: heatmap names the busiest room');
  await run('heatmap off', 'Heatmap off');
  check(await page.isHidden('[data-heatlegend]'), 'terminal: heatmap off');

  await finish(browser, world, errors, 'replay & heatmap');
})().catch((e) => { console.error(e); process.exit(1); });
