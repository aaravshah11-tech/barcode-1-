// Network intel (internet checks, outage, speed test, Agent links) and Comms (message → Agent screen → acknowledge).
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
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  agent.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  await api('PATCH', `/agents/${agent.id}`, { name: 'Kitchen' });

  // Internet checks
  await page.waitForFunction(() => /Connected\s+\d+ ms/.test(document.querySelector('[data-network]')?.textContent || ''), null, { timeout: 15000 });
  check(true, 'Network panel: internet connected, with latency in ms');
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__hq.netmon.check());
  await page.waitForSelector('.netchart path.lat');
  check(true, 'latency chart drawn');
  // An outage: the check fails, then recovers
  await page.evaluate(() => { window.__hq.netmon.probeUrl = 'http://127.0.0.1:1/nothing'; return window.__hq.netmon.check(); });
  await page.waitForSelector('[data-log] >> text=Internet connection lost');
  await page.waitForFunction(() => document.querySelector('[data-network]').textContent.includes('Down'));
  check(await page.$$eval('.netchart .down', (d) => d.length) >= 1, 'outage: logged, shown as Down, red mark on the chart');
  await page.evaluate(() => { window.__hq.netmon.probeUrl = new URL('../favicon.svg', location.href).href; return window.__hq.netmon.check(); });
  await page.waitForSelector('[data-log] >> text=Internet connection restored');
  check((await page.textContent('[data-network]')).includes('outage'), 'restored: logged; uptime and outage count shown');
  // Hover tooltip on the chart
  await page.locator('.netchart svg').scrollIntoViewIfNeeded();
  const svg = await page.locator('.netchart svg').boundingBox();
  await page.mouse.move(svg.x + svg.width - 4, svg.y + svg.height / 2);
  await page.waitForSelector('.netchart .tip:not([hidden])');
  check(/\d\d:\d\d · (\d+ ms|down)/.test(await page.textContent('.netchart .tip')), 'hovering the chart shows the time and latency');

  // Speed test (Cloudflare is out of reach in the test machine → estimate)
  await page.click('[data-speedtest]');
  await page.waitForSelector('[data-log] >> text=Speed test:', { timeout: 60000 });
  check(/\d+(\.\d)? ↓/.test(await page.textContent('[data-network]')), 'Run speed test: result in Mbps, logged');

  // Agent link round-trip time
  await page.waitForFunction(() => /\d+ ms/.test(document.querySelector('.links')?.textContent || ''), null, { timeout: 25000 });
  check(true, 'Agent links table shows each Agent’s round-trip time');
  await shot(page, 'network-comms');

  // Comms
  await page.click('[data-quick="Dinner is ready"]');
  check(await page.inputValue('[data-comms] [name=text]') === 'Dinner is ready', 'quick phrase fills the message');
  await page.selectOption('[data-commstarget]', agent.id);
  await page.click('[data-comms] .btn-primary');
  await agent.p.waitForSelector('.comms-screen >> text=Dinner is ready', { timeout: 10000 });
  check(true, 'the message appears full-screen on the Agent');
  check(await agent.p.isVisible('[data-banner]'), 'the Agent banner stays visible');
  await shot(agent.p, 'agent-message');
  await page.waitForSelector('[data-sent] >> text=0/1 ack');
  await agent.p.click('.comms-screen [data-ack]');
  await page.waitForSelector('[data-sent] >> text=1/1 ack');
  await page.waitForSelector('[data-log] >> text=acknowledged: “Dinner is ready”');
  check(true, 'Acknowledge on the Agent → 1/1 ack at HQ and in the Mission Log');
  await finish(browser, world, errors, 'network & comms');
})().catch((e) => { console.error(e); process.exit(1); });
