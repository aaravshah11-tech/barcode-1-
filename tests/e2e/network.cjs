// Redesign part 5: NETWORK SECURITY — asset register (SENTINEL's devices, manual, router import),
// new/untrusted device alerts, health check with plain-English advice, internet history.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';
const ROUTER = `Device Name\tIP Address\tMAC Address
Mums-iPhone\t192.168.1.23\t3C:22:FB:12:34:56
living-room-tv\t192.168.1.40\tA8-23-FE-AA-BB-CC
ESP_1A2B3C\t192.168.1.77\t24:0a:c4:1a:2b:3c`;

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);

  await page.keyboard.press('7');
  await page.waitForSelector('.asset-table [data-asset]');
  check((await page.textContent('.scope-note')).includes('SENTINEL never scans anything'), 'states clearly: home network only, nothing is scanned');
  const t0 = await page.textContent('.asset-table');
  check(t0.includes('HQ computer') && t0.includes('AGENT-01') && /Trusted/.test(t0), 'register starts with SENTINEL’s own devices (HQ, Agents), trusted');

  // Import from the router
  await page.click('[data-nimport]');
  await page.fill('[data-importform] textarea', ROUTER);
  await page.click('[data-importform] .btn-primary');
  await page.waitForSelector('text=3 devices read · 3 new');
  const t1 = await page.textContent('.asset-table');
  check(t1.includes('Mums-iPhone') && t1.includes('Apple') && t1.includes('LG') && t1.includes('Espressif'), 'router list imported; makers looked up from the MAC address');
  check(await page.textContent('[data-nfilter="untrusted"]') === 'Untrusted (3)', 'new devices start untrusted');
  await page.waitForFunction(() => (document.querySelector('[data-badge="triage"]')?.textContent | 0) >= 3);
  check(true, '“New device on your network” alerts go to Triage');
  await shot('network-assets');

  // Edit: name, owner, trusted
  await page.click('.asset-table tr:has-text("Mums-iPhone") [data-nedit]');
  await page.fill('[data-assetform] [name=aname]', 'Mum’s iPhone');
  await page.fill('[data-assetform] [name=owner]', 'Mum');
  await page.check('[data-assetform] [name=trusted]');
  await page.click('[data-assetform] .btn-primary');
  await page.waitForSelector('.asset-table tr:has-text("Mum’s iPhone") .trust.yes');
  check(true, 'edit a device: name, owner, mark trusted');
  await page.click('.asset-table tr:has-text("living-room-tv") [data-ntrust]');
  await page.waitForSelector('.asset-table tr:has-text("living-room-tv") .trust.yes');
  check(true, 'one-click trust toggle');
  // Add by hand
  await page.click('[data-nadd]');
  await page.fill('[data-assetform] [name=aname]', 'Garden camera');
  await page.selectOption('[data-assetform] [name=atype]', 'camera');
  await page.click('[data-assetform] .btn-primary');
  await page.waitForSelector('.asset-table >> text=Garden camera');
  check(true, 'add a device by hand');

  // Health check
  await page.click('[data-ntab="health"]');
  await page.waitForSelector('.findings li');
  await page.click('[data-nans="adminpw"][data-val="no"]');
  await page.waitForSelector('.findings .lv-high >> text=admin');
  check(true, 'router question answered “No” → “Fix now” with what to do');
  await page.click('[data-nans="wpa"][data-val="yes"]');
  await page.waitForSelector('[data-nans="wpa"][data-val="yes"][aria-pressed="true"]');
  const health = await page.textContent('.health-grid');
  check(/\d+\s*out of 100/.test(health) && health.includes('not marked as trusted') && health.includes('Two-step sign-in'), 'score plus plain-English recommendations');
  await shot('network-health');

  // Internet history
  await page.click('[data-ntab="history"]');
  await page.waitForSelector('.hist-grid');
  check((await page.textContent('.hist-grid')).includes('Uptime, last 30 days') && !!(await page.$('.hist-grid .mini-bars')), 'internet history: daily uptime chart, response time, speed tests, outages');
  await shot('network-history');

  await finish(browser, world, errors, 'network');
})().catch((e) => { console.error(e); process.exit(1); });
