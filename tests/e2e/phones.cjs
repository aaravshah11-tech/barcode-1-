// Your own phone: link it to HQ, it must log in with the Director's codename + PIN, then sees HQ live; unlink.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const dash = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  dash.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  await openHQ(dash, world); // Director TESTER / PIN 2468

  await dash.click('[data-settings]');
  await dash.click('[data-tab="phones"]');
  await dash.click('[data-linkphone]');
  await dash.waitForSelector('[data-linkbox] [data-qr] svg');
  const link = await dash.getAttribute('[data-linkbox] [data-qr]', 'data-link');
  check(/hq\/remote\.html#hq=sntl-[a-z0-9]{8}&link=[A-Z0-9]{6}/.test(link), 'Link a phone shows a QR code');

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  phone.on('pageerror', (e) => errors.push(`[phone] ${e.message}`));
  await phone.goto(link);
  await phone.fill('[data-link] [name=label]', 'Director phone');
  await phone.click('[data-link] button');
  await dash.waitForSelector('text=Phone linked');
  check(true, 'phone linked (HQ says so)');

  // Locked until the codename + PIN are entered
  await phone.waitForSelector('.boot, [data-login]', { timeout: 20000 });
  if (await phone.$('.boot')) await phone.click('.boot');
  await phone.waitForSelector('[data-login]', { timeout: 20000 });
  check(!(await phone.$('[data-agents]')), 'the phone shows nothing until you log in');
  await phone.fill('[name=codename]', 'tester'); await phone.fill('[name=pin]', '1111');
  await phone.click('[data-login] button');
  await phone.waitForSelector('text=Incorrect username');
  check(true, 'wrong PIN on the phone → “Incorrect username or password”');
  await phone.waitForSelector('[data-login] button:not([disabled])');
  await phone.fill('[name=pin]', '2468');
  await phone.click('[data-login] button');
  await phone.waitForSelector('[data-threat]', { timeout: 20000 });
  check(true, 'right codename + PIN → the phone opens the Command Centre');
  await phone.waitForTimeout(800);
  if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-command-centre.png'), fullPage: true });

  // Live: switching to AWAY on the phone shows on HQ
  await phone.click('.modes-mobile [data-mode="away"]');
  await dash.waitForSelector('[data-log] >> text=Alert state: AWAY');
  check(true, 'AWAY pressed on the phone → HQ switches to AWAY');

  // Reloading the phone keeps the login for a while (no PIN needed again straight away)
  await phone.reload();
  await phone.waitForSelector('[data-threat]', { timeout: 20000 });
  check(true, 'reloading the phone keeps it logged in');

  // Unlink from HQ
  await dash.waitForSelector('[data-unlinkv]');
  await dash.click('[data-unlinkv]');
  await phone.waitForSelector('text=isn’t linked', { timeout: 20000 });
  check(true, 'Unlink on HQ cuts the phone off straight away');

  await finish(browser, world, errors, 'phones');
})().catch((e) => { console.error(e); process.exit(1); });
