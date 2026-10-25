// Command Centre: first-time password, dashboard, presence, settings, export, recruit QR, login.
const { chromium } = require('playwright');
const path = require('path');
const { startHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const hq = await startHQ();
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text())) errors.push(m.text()); });
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  await page.goto(hq.url + '/');
  await page.waitForSelector('[data-gate]');
  check((await page.textContent('#app')).includes('First time here'), 'first visit on the HQ computer asks for a new password');
  await page.fill('[name=pw]', 'secret1');
  await page.fill('[name=pw2]', 'secret2');
  await page.click('[data-gate] button');
  await page.waitForSelector('text=don’t match');
  await page.fill('[name=pw2]', 'secret1');
  await page.click('[data-gate] button');
  await page.waitForSelector('.boot');
  check(true, 'boot animation plays');
  await page.waitForTimeout(700);
  await shot('boot');
  await page.waitForSelector('.boot', { state: 'detached', timeout: 8000 });
  await page.waitForSelector('[data-threat].GREEN');
  check((await page.textContent('[data-threat]')).includes('THREAT GREEN'), 'threat level GREEN');
  check((await page.textContent('[data-agents]')).includes('NO AGENTS YET'), 'empty Agents list explains how to recruit');
  check((await page.textContent('[data-log]')).includes('SENTINEL // HQ ONLINE') && (await page.textContent('[data-log]')).includes('HQ password set'), 'Mission Log shows HQ ONLINE and the password being set');
  check(await page.evaluate(() => document.body.classList.contains('fx')), 'scanline effects on by default');
  await page.waitForTimeout(600);
  await shot('dashboard-empty');

  // Presence switch
  await page.click('[data-mode="away"]');
  await page.waitForSelector('[data-mode="away"][aria-pressed="true"]');
  await page.waitForSelector('[data-log] >> text=Presence set to AWAY');
  check(true, 'AWAY switch saved and logged');

  // Recruit dialog
  await page.click('[data-recruit]');
  await page.waitForSelector('.recruit [data-qr] svg');
  const code = (await page.textContent('[data-code]')).trim();
  check(/^[A-Z2-9]{6}$/.test(code), `recruit shows a QR code and a 6-character code (${code})`);
  check((await page.textContent('.recruit')).includes(`http://127.0.0.1:${hq.httpPort}`), 'recruit shows the setup address for devices without a camera');
  await shot('recruit');
  await page.keyboard.press('Escape');

  // Settings: effects off, retention, export
  await page.click('[data-settings]');
  await page.uncheck('[data-general] [name=fx]');
  await page.fill('[data-general] [name=retentionDays]', '7');
  await page.click('[data-general] button');
  await page.waitForSelector('.toast >> text=Settings saved');
  check(!(await page.evaluate(() => document.body.classList.contains('fx'))), 'effects can be switched off');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a[href*="format=csv"]')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  check(csv.includes('Time (UTC)') && csv.includes('Presence set to AWAY'), 'Mission Log exports as CSV');
  // Log out and back in
  await page.click('[data-logout]');
  await page.waitForSelector('[data-gate]');
  await page.fill('[name=pw]', 'wrong-one');
  await page.click('[data-gate] button');
  await page.waitForSelector('text=Wrong password');
  await page.fill('[name=pw]', 'secret1');
  await page.click('[data-gate] button');
  await page.waitForSelector('[data-threat]');
  check(true, 'log out, wrong password refused, right password lets you back in');

  // Someone else on the network without the password
  const other = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const res = await other.request.get(hq.url + '/api/state');
  check(res.status() === 401, 'the dashboard data needs the password');
  const setup = await other.request.post(hq.url + '/api/setup', { data: { password: 'takeover' } });
  check(setup.status() === 409, 'password can’t be set again by someone else');

  await finish(browser, hq, errors, 'dashboard');
})().catch((e) => { console.error(e); process.exit(1); });
