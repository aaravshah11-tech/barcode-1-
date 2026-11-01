// v3 phase 2: the OPERATIONS FLOOR — Current Picture, Triage summary, Agent Fleet, Perimeter,
// Activity Timeline (drag to replay), layouts Day / Night watch / Wall, phone layout.
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
  const shot = (n, p = page) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  await page.evaluate(async () => { const { TEMPLATES } = await import(new URL('../shared/house.js', location.href).href); await window.__hq.api('PUT', '/house', TEMPLATES.house.make()); });
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  const f0 = (await api('GET', '/house')).floors[0];
  await api('PUT', `/agents/${agent.id}/place`, { floorId: f0.id, x: 7, y: 2 });
  await api('PATCH', `/agents/${agent.id}`, { mission: 'motion' });

  await page.waitForSelector('[data-picture] .kfig');
  check((await page.textContent('[data-picture]')).includes('HOME') && /Quiet\. No alerts in the last 4 hours/.test(await page.textContent('[data-picture]')), 'Current Picture: alert state, plain summary (“Quiet. No alerts in the last 4 hours.”)');
  await page.waitForSelector('[data-agents] .fleet-row');
  check(/Kitchen · Motion watch/i.test(await page.textContent('[data-agents]')) && !!(await page.$('.fleet-row .batbar')) && !!(await page.$('.fleet-row .sig')), 'Agent Fleet: codename, room, mission, battery bar, signal');

  await api('PATCH', '/settings', { mode: 'away' });
  await page.evaluate((id) => window.__hq.hq.agentEvent(id, { kind: 'motion', message: 'Motion detected' }), agent.id);
  await page.waitForFunction(() => /1 open alert; most serious: Motion detected — Kitchen \(ALT-\d{6}\)/.test(document.querySelector('[data-picture]').textContent));
  check(true, 'Current Picture updates: “1 open alert; most serious: … (ALT-…)”');
  check(/Alert\s*1/.test(await page.textContent('[data-sevsum2]')), 'Triage summary: open counts by severity');
  await page.waitForSelector('[data-acttl] .tl-lane[data-lane="inside"] i');
  check(true, 'Activity Timeline: the event appears on the Inside lane');
  const lane = await page.$('[data-acttl] .tl-lane[data-lane="inside"]'); await lane.scrollIntoViewIfNeeded(); const bb = await lane.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.99, bb.y + 5); await page.mouse.down(); await page.mouse.move(bb.x + bb.width * 0.95, bb.y + 5, { steps: 4 }); await page.mouse.up();
  await page.waitForSelector('[data-replaybar]:not([hidden]) >> text=Replay · Timeline');
  check(true, 'dragging along the timeline replays that moment on the map');
  check((await page.textContent('[data-perimini]')).includes('Back garden'), 'Perimeter panel: front, garden, garage zones');
  await shot('v2-floor');

  await page.selectOption('[data-wslayout]', 'Wall');
  await page.waitForSelector('[data-panel="map"]');
  check(!(await page.$('[data-panel="log"]')) && !!(await page.$('[data-panel="timeline"]')), 'Wall layout: map, picture, fleet, perimeter, timeline');
  await page.selectOption('[data-wslayout]', 'Day');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const order = await page.$$eval('[data-wsgrid] [data-panel]', (els) => els.map((e) => [e.dataset.panel, e.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]).map((x) => x[0]).slice(0, 4).join(','));
  check(order === 'picture,queue,agents,perimeter', `phone: stacked cards in order (${order})`);
  await shot('v2-phone');

  await finish(browser, world, errors, 'floor');
})().catch((e) => { console.error(e); process.exit(1); });
