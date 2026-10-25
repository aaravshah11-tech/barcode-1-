// Wi-Fi recon: devices found on the network, people, owners, arrival/departure, private addresses.
// Uses SENTINEL_FAKE_ARP (a JSON file standing in for the computer's ARP table).
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

const PHONE = { ip: '192.168.1.23', mac: 'DA:12:34:56:78:9A', hostname: 'Alexs-iPhone' };
const LAPTOP = { ip: '192.168.1.30', mac: '3c:22:fb:01:02:03' };
const ROUTER = { ip: '192.168.1.1', mac: '00:11:22:33:44:55', hostname: 'router' };

(async () => {
  const arp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-arp-')), 'arp.json');
  const setArp = (list) => fs.writeFileSync(arp, JSON.stringify(list));
  setArp([PHONE, LAPTOP, ROUTER]);
  const hq = await startHQ({ env: { SENTINEL_NO_RECON: '', SENTINEL_FAKE_ARP: arp } });
  const browser = await chromium.launch();
  const errors = [];
  let expectBad = false; // the API safety checks below fail on purpose
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text()) && !(expectBad && /Failed to load resource/.test(m.text()))) errors.push(m.text()); });
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  await page.goto(hq.url + '/');
  await page.fill('[name=pw]', 'secret1');
  await page.fill('[name=pw2]', 'secret1');
  await page.click('[data-gate] button');
  await page.waitForSelector('.boot', { state: 'detached', timeout: 8000 });
  check((await page.textContent('[data-peoplelist]')).includes('No one tracked'), 'Who’s home starts empty');

  // People tab
  await page.click('[data-people]');
  await page.waitForSelector('[data-devices] [data-mac]');
  check(await page.locator('[data-devices] [data-mac]').count() === 3, 'all 3 devices on the "Wi-Fi" are listed');
  const phoneRow = page.locator('[data-mac="da:12:34:56:78:9a"]');
  check((await phoneRow.textContent()).includes('PRIVATE ADDRESS'), 'the iPhone’s random address gets a PRIVATE ADDRESS badge');
  check(!(await page.locator('[data-mac="3c:22:fb:01:02:03"]').textContent()).includes('PRIVATE'), 'a normal address has no badge');
  check((await phoneRow.textContent()).includes('Alexs-iPhone'), 'device names from the network are shown');
  check((await page.textContent('[data-status]')).includes('3 device(s) answered'), 'scan status shown');

  await page.fill('[data-addperson] [name=name]', 'Alex');
  await page.click('[data-addperson] button');
  await page.waitForSelector('[data-person] [data-pname]');
  check((await page.textContent('[data-peoplerows]')).includes('AWAY'), 'new person starts AWAY (no devices yet)');
  await page.locator('[data-mac="da:12:34:56:78:9a"] [data-dname]').fill('Alex’s iPhone');
  await page.locator('[data-mac="da:12:34:56:78:9a"] [data-dname]').press('Tab');
  await page.waitForSelector('text=Device named');
  await page.locator('[data-mac="da:12:34:56:78:9a"] [data-downer]').selectOption({ label: 'Alex' });
  await page.waitForFunction(() => document.querySelector('[data-peoplerows]')?.textContent.includes('HOME'));
  check(true, 'giving the phone to Alex marks Alex HOME');
  await shot('people-tab');

  // Ignore the router
  await page.locator('[data-mac="00:11:22:33:44:55"] [data-dignore]').check();
  await page.waitForFunction(() => !document.querySelector('[data-mac="00:11:22:33:44:55"]'));
  check(true, 'ignored device hidden from the list');
  await page.check('[data-showall]');
  await page.waitForSelector('[data-mac="00:11:22:33:44:55"]');
  check(true, '"Show ignored" brings it back');

  // Grace period = 1 minute, then the phone leaves
  await page.fill('[data-timing] [name=graceMin]', '1');
  await page.click('[data-timing] button');
  await page.waitForSelector('text=Timing saved');
  await page.click('[data-close]').catch(() => page.keyboard.press('Escape'));
  await page.waitForSelector('[data-peoplelist] >> text=HOME');
  check(true, 'dashboard Who’s home shows Alex HOME');
  check((await page.textContent('[data-log]')).includes('Alex arrived home'), 'arrival logged in the Mission Log');

  setArp([LAPTOP, ROUTER]);
  console.log('  (waiting ~65 s for the 1-minute grace period…)');
  const t0 = Date.now();
  let gone = false;
  while (Date.now() - t0 < 90000 && !gone) {
    await page.waitForTimeout(5000);
    await page.evaluate(() => fetch('/api/recon/scan', { method: 'POST' }));
    gone = (await page.textContent('[data-log]')).includes('Alex left home');
  }
  check(gone, 'departure logged once the phone is gone longer than the grace period');
  await page.waitForSelector('[data-peoplelist] >> text=AWAY');
  check((await page.textContent('[data-threat]')).includes('GREEN') && (await page.getAttribute('[data-threat]', 'title') || '').length >= 0, 'still GREEN (nothing moving)');
  const st = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  check(st.threat.away === true, 'HQ knows nobody is home (motion now would be RED)');

  // Back home
  setArp([PHONE, LAPTOP, ROUTER]);
  await page.evaluate(() => fetch('/api/recon/scan', { method: 'POST' }));
  await page.waitForSelector('[data-peoplelist] >> text=HOME');
  check(true, 'coming back marks Alex HOME again');

  // Tracking off
  await page.click('[data-people]');
  await page.waitForSelector('[data-penabled]');
  await page.uncheck('[data-penabled]');
  await page.waitForFunction(() => document.querySelector('[data-peoplerows]')?.textContent.includes('NOT TRACKED'));
  check(true, 'switching tracking off for a person works');

  // API safety
  expectBad = true;
  const bad = await page.evaluate(async () => [
    (await fetch('/api/devices/zz', { method: 'PATCH', body: '{}' })).status,
    (await fetch('/api/people', { method: 'POST', body: JSON.stringify({ name: ' ' }) })).status,
    (await fetch('/api/devices/' + encodeURIComponent('3c:22:fb:01:02:03'), { method: 'PATCH', body: JSON.stringify({ personId: 'nobody' }) })).status,
  ]);
  check(bad.join() === '404,400,400', `bad requests refused (${bad.join()})`);

  await finish(browser, hq, errors, 'Wi-Fi recon');
})().catch((e) => { console.error(e); process.exit(1); });
