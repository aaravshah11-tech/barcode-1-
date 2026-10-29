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
  // No boot animation any more: straight to a plain sign-in screen
  await page.waitForSelector('[data-login] [name=pin2]', { timeout: 15000 });
  check(!(await page.$('.boot, .boot-bar, [data-scanner]')), 'no boot animation or fake fingerprint scan');
  check(await page.evaluate(() => document.documentElement.dataset.theme) === 'graphite', 'default theme is Graphite');
  const banners = await page.$$eval('.cbanner', (b) => b.map((x) => `${x.className}:${x.textContent}`));
  check(banners.length === 2 && banners.every((t) => t.includes('SENTINEL // RESTRICTED – HOUSEHOLD')), 'classification banner top and bottom: SENTINEL // RESTRICTED – HOUSEHOLD');
  check((await page.textContent('.login-notice')).includes('monitored and logged'), 'sign-in shows “use of this system is monitored and logged”');
  check(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('IBM Plex Sans')), 'IBM Plex Sans font');
  await page.fill('[name=codename]', 'nightowl');
  await page.fill('[name=pin]', '13579');
  await page.fill('[name=pin2]', '97531');
  await page.click('[data-login] button');
  await page.waitForSelector('text=don’t match');
  await page.fill('[name=pin2]', '13579');
  await shot('login-setup');
  await page.click('[data-login] button');
  await page.waitForSelector('[data-threat]', { timeout: 10000 });
  check(true, 'Operations screen opens after sign-in');
  await page.waitForFunction(() => document.querySelector('[data-net]')?.textContent.toUpperCase().includes('UPLINK'), null, { timeout: 15000 });
  check(true, 'HQ goes ONLINE (matchmaking server reached)');
  await page.waitForSelector('[data-threat].GREEN');
  check((await page.textContent('[data-agents]')).includes('No agents deployed'), 'empty Agents list explains how to recruit');
  check((await page.textContent('[data-log]')).includes('HQ session started'), 'Mission Log: HQ ONLINE');
  check(!(await page.evaluate(() => document.body.classList.contains('fx'))), 'no scanline / glitch effects');
  check(await page.$$eval('[data-wsgrid] [data-panel]', (p) => p.length) === 7, 'workspace: 7 panels on the Operations screen');

  // Status bar
  await page.waitForFunction(() => document.querySelector('[data-sbop]')?.textContent === 'NIGHTOWL');
  const sb = await page.textContent('[data-statusbar]');
  check(/DIRECTOR/.test(sb) && /HOME/.test(sb) && /\d\d:\d\d:\d\d/.test(sb) && /Nominal/.test(sb) && /0\/0/.test(sb), 'status bar: operator, role, session timer, alert state, UTC/local time, HQ health, Agents online');

  // Command palette
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.palette [data-pq]');
  await page.fill('.palette [data-pq]', 'away');
  check((await page.textContent('.palette .sel')).includes('AWAY'), 'Ctrl+K command palette: typing “away” finds “Set AWAY”');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.palette', { state: 'detached' });
  await page.keyboard.press('?');
  await page.waitForSelector('.sheet >> text=Keyboard shortcuts');
  check(true, '? shows the keyboard shortcuts');
  await page.keyboard.press('Escape');

  // Workspace: edit, move a panel, save the layout
  await page.click('[data-wsedit]');
  await page.waitForSelector('[data-wsgrid].editing');
  const before = await page.$eval('[data-panel="comms"]', (e) => e.style.gridColumn);
  const head = await page.$('[data-panel="comms"] .panel-head h2'), hb = await head.boundingBox();
  await page.mouse.move(hb.x + 5, hb.y + 5); await page.mouse.down();
  await page.mouse.move(hb.x - 600, hb.y + 5, { steps: 8 }); await page.mouse.up();
  const after = await page.$eval('[data-panel="comms"]', (e) => e.style.gridColumn);
  check(before !== after, `Edit layout: drag a panel by its title bar (${before} → ${after})`);
  page.once('dialog', (d) => d.accept('Night watch'));
  await page.click('[data-wssave]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sentinel.layouts')).current === 'Night watch');
  check(true, 'Save as… stores the layout under a name');
  await page.selectOption('[data-wslayout]', 'Map focus');
  await page.waitForSelector('[data-panel="map"]');
  check(true, 'presets: Map focus');
  await page.selectOption('[data-wslayout]', 'Standard');
  await page.click('[data-wsedit]');
  await shot('dashboard-empty');

  // Themes: Graphite and Navy only
  await page.click('[data-settings]');
  check(await page.$$eval('.theme-chip', (t) => t.map((x) => x.dataset.theme).join()) === 'graphite,navy', 'themes: Graphite and Navy');
  await page.click('[data-theme="navy"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'navy');
  check(true, 'theme picker: Navy');
  await page.click('[data-theme="graphite"]');
  await page.keyboard.press('Escape');

  // Lock, wrong PIN, right PIN
  await page.click('[data-lock]');
  await page.waitForSelector('[data-login]');
  check(!(await page.$('[data-agents]')), 'locking hides everything');
  await page.fill('[name=codename]', 'NIGHTOWL'); await page.fill('[name=pin]', '0000');
  await page.click('[data-login] button');
  await page.waitForSelector('text=Incorrect username or password');
  await page.waitForSelector('text=attempts remaining');
  check(true, 'wrong PIN → “Incorrect username or password” (attempts remaining shown)');
  await page.waitForSelector('[data-login] button:not([disabled])');
  await page.fill('[name=pin]', '13579');
  await page.click('[data-login] button');
  await page.waitForSelector('[data-threat]', { timeout: 10000 });
  check((await page.textContent('[data-log]')).includes('Failed login attempt'), 'failed login is written in the Mission Log');

  // HOME / AWAY
  await page.click('[data-mode="away"]');
  await page.waitForSelector('[data-mode="away"][aria-pressed="true"]');
  await page.waitForSelector('[data-log] >> text=Security mode: AWAY');
  check((await page.textContent('[data-peoplelist]')).toUpperCase().includes('AWAY'), 'AWAY switch saved, logged and shown');
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

  // Settings: export, backup
  await page.click('[data-settings]');
  check(!(await page.$('[name=fx]')), 'no “effects” switch any more');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="csv"]')]);
  const csvText = require('fs').readFileSync(await csv.path(), 'utf8');
  check(csv.suggestedFilename().endsWith('.csv') && csvText.includes('Security mode: AWAY'), 'Mission Log exports as CSV');
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
  await page.waitForSelector('[data-log] >> text=Security mode: AWAY', { timeout: 15000 });
  check(true, 'Mission Log is still there after reloading the page');
  await page.waitForFunction(() => document.querySelector('[data-net]')?.textContent.toUpperCase().includes('UPLINK'), null, { timeout: 30000 });
  check(true, 'HQ comes back ONLINE with the same HQ code after a reload');

  // A second HQ tab in the same browser is refused politely
  const second = await ctx.newPage();
  await second.goto(world.hqUrl);
  await second.waitForSelector('text=already open in another tab');
  check(true, 'opening HQ twice: the second tab explains instead of fighting');

  await finish(browser, world, errors, 'dashboard');
})().catch((e) => { console.error(e); process.exit(1); });
