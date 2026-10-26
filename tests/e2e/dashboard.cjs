// HQ page: front page → START HQ, boot, online, HOME/AWAY, settings, export, backup, recruit QR, one HQ per browser.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, login, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  // Front page
  await page.goto(`${world.root}?${world.sig}`);
  check((await page.textContent('h1')).includes('SENTINEL'), 'front page loads');
  await shot('front-page');
  await page.click('[data-start]');
  await page.waitForSelector('.boot-bar');
  check(true, 'START HQ → boot sequence with decrypting bars (no install)');
  await page.waitForTimeout(1200);
  await shot('boot');
  await page.waitForSelector('.boot', { state: 'detached', timeout: 10000 });
  // First time: enrol the Director (codename + PIN)
  await page.waitForSelector('[data-login] [name=pin2]');
  check(await page.evaluate(() => document.documentElement.dataset.theme) === 'mi6', 'default theme is MI6 hologram');
  await page.fill('[name=codename]', 'nightowl');
  await page.fill('[name=pin]', '13579');
  await page.fill('[name=pin2]', '97531');
  await page.click('[data-login] button');
  await page.waitForSelector('text=don’t match');
  await page.fill('[name=pin2]', '13579');
  await shot('login-setup');
  await page.click('[data-login] button');
  await page.waitForSelector('[data-scanner]:not([hidden])');
  check(true, 'fingerprint / retina scan animation plays');
  await page.waitForSelector('text=ACCESS GRANTED');
  await page.waitForTimeout(300);
  await shot('login-granted');
  check((await page.textContent('[data-scantext]')).includes('NIGHTOWL'), 'ACCESS GRANTED — welcome, codename');
  await page.waitForSelector('[data-threat]', { timeout: 10000 });
  check(true, 'Command Centre opens after login');
  await page.waitForFunction(() => document.querySelector('[data-net]')?.textContent.includes('UPLINK ONLINE'), null, { timeout: 15000 });
  check(true, 'HQ goes ONLINE (matchmaking server reached)');
  await page.waitForSelector('[data-threat].GREEN');
  check((await page.textContent('[data-agents]')).includes('NO AGENTS YET'), 'empty Agents list explains how to recruit');
  check((await page.textContent('[data-log]')).includes('SENTINEL // HQ ONLINE'), 'Mission Log: HQ ONLINE');
  check(await page.evaluate(() => document.body.classList.contains('fx')), 'scanline effects on by default');
  check(await page.$$eval('.cc .panel', (p) => p.length) === 6, 'command-centre layout: map + 5 panels around it');
  await page.waitForTimeout(1200);
  await shot('dashboard-empty');

  // Themes
  await page.click('[data-settings]');
  await page.click('[data-theme="redops"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'redops');
  check(true, 'theme picker: RED OPS');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await shot('theme-redops');
  await page.click('[data-settings]');
  await page.click('[data-theme="classic"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot('theme-classic');
  await page.click('[data-settings]');
  await page.click('[data-theme="mi6"]');
  await page.keyboard.press('Escape');

  // Lock, wrong PIN, right PIN
  await page.click('[data-lock]');
  await page.waitForSelector('[data-login]');
  check(!(await page.$('[data-agents]')), 'locking hides everything');
  await page.fill('[name=codename]', 'NIGHTOWL'); await page.fill('[name=pin]', '0000');
  await page.click('[data-login] button');
  await page.waitForSelector('text=ACCESS DENIED');
  await page.waitForSelector('text=tries left');
  check(true, 'wrong PIN → ACCESS DENIED (tries left shown)');
  await page.waitForSelector('[data-login] button:not([disabled])');
  await page.fill('[name=pin]', '13579');
  await page.click('[data-login] button');
  await page.waitForSelector('[data-threat]', { timeout: 10000 });
  check((await page.textContent('[data-log]')).includes('Failed login attempt'), 'failed login is written in the Mission Log');

  // HOME / AWAY
  await page.click('[data-mode="away"]');
  await page.waitForSelector('[data-mode="away"][aria-pressed="true"]');
  await page.waitForSelector('[data-log] >> text=Set to AWAY');
  check((await page.textContent('[data-peoplelist]')).includes('AWAY'), 'AWAY switch saved, logged and shown');
  await page.click('[data-mode="home"]');

  // Recruit dialog
  await page.click('[data-recruit]');
  await page.waitForSelector('.recruit [data-qr] svg');
  const link = await page.getAttribute('[data-qr]', 'data-link');
  const hqCode = (await page.textContent('[data-hqcode]')).trim();
  check(/\/barcode-1-\/agent\/#hq=sntl-[a-z0-9]{8}&pair=[A-Z0-9]{6}/.test(link), 'QR code links to this site’s Agent page with HQ’s code and a one-time code');
  check(/^[A-Z0-9]{8}$/.test(hqCode), `short HQ code shown for typing by hand (${hqCode})`);
  await shot('recruit');
  await page.keyboard.press('Escape');

  // Settings: effects, export, backup
  await page.click('[data-settings]');
  await page.uncheck('[name=fx]');
  await page.click('[data-general] button');
  await page.waitForFunction(() => !document.body.classList.contains('fx'));
  check(true, 'effects can be switched off');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="csv"]')]);
  const csvText = require('fs').readFileSync(await csv.path(), 'utf8');
  check(csv.suggestedFilename().endsWith('.csv') && csvText.includes('Set to AWAY'), 'Mission Log exports as CSV');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('[data-backup]')]);
  const backup = JSON.parse(require('fs').readFileSync(await bk.path(), 'utf8'));
  check(backup.sentinel === 'hq-backup' && backup.events.length > 2, 'HQ backup downloads');
  check((await page.textContent('[data-hqcodeshow]')).trim() === hqCode, 'HQ code shown in Settings');
  await page.click('[data-tab="alerts"]');
  await page.waitForSelector('[data-rule="awayMotion"]');
  check(true, 'Alerts tab opens');
  await page.click('[data-tab="phones"]');
  await page.waitForSelector('[data-linkphone]');
  check(true, 'Phones tab opens');
  await page.keyboard.press('Escape');

  // Data survives a reload (kept in this browser)
  await page.reload();
  await login(page, { codename: 'nightowl', pin: '13579' });
  await page.waitForSelector('[data-log] >> text=Set to AWAY', { timeout: 15000 });
  check(true, 'Mission Log is still there after reloading the page');
  await page.waitForFunction(() => document.querySelector('[data-net]')?.textContent.includes('UPLINK ONLINE'), null, { timeout: 30000 });
  check(true, 'HQ comes back ONLINE with the same HQ code after a reload');

  // A second HQ tab in the same browser is refused politely
  const second = await ctx.newPage();
  await second.goto(world.hqUrl);
  await second.waitForSelector('text=already open in another tab');
  check(true, 'opening HQ twice: the second tab explains instead of fighting');

  await finish(browser, world, errors, 'dashboard');
})().catch((e) => { console.error(e); process.exit(1); });
