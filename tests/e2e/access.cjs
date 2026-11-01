// Redesign part 7: ACCESS CONTROL — users and roles enforced by HQ, two-step sign-in, sessions,
// the tamper-evident audit log, the shift log / handover, and formal alert-state changes.
const { chromium } = require('playwright');
const path = require('path');
const { go, startWorld, launch, openHQ, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world); // Director TESTER / 2468
  const api = hqApi(page);
  const code = (secret, ahead = 0) => page.evaluate(async ([s, k]) => { const t = await import(new URL('../shared/totp.js', location.href).href); return t.hotp(s, t.stepOf() + k); }, [secret, ahead]);

  // ---- Security (single operator: account, two-step sign-in, sessions) ----
  await go(page, 'access');
  await page.waitForSelector('[data-abody2] [data-sess]');
  check(await page.$$eval('.rail [data-view]', (b) => b.map((x) => x.dataset.label).join('|')).then((t) => t.includes('Administration') && t.includes('Records') && !t.includes('Security')), 'Security lives inside Administration (not a separate rail item)');
  check(!(await page.$('[data-auser]')), 'single operator: no “add user” — one account with full rights');

  // ---- My phone signing in ----
  const { code: link } = await api('POST', '/pair', { role: 'viewer' });
  const hqId = (await api('GET', '/state')).info.hqId;
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  phone.on('pageerror', (e) => errors.push(`[phone] ${e.message}`));
  await phone.goto(`${world.remoteUrl}#hq=${hqId}&link=${link}`);
  await phone.fill('[data-link] [name=label]', 'My phone');
  await phone.click('[data-link] button');
  await phone.waitForSelector('[data-login]', { timeout: 20000 });
  await phone.fill('[name=codename]', 'tester'); await phone.fill('[name=pin]', '2468');
  await phone.click('[data-login] button');
  await phone.waitForSelector('[data-threat]', { timeout: 20000 });
  check((await phone.textContent('[data-statusbar]')).includes('TESTER'), 'my phone signs in too: callsign in the status strip');
  await phone.click('.modes-mobile [data-mode="away"]').catch(() => phone.evaluate(() => document.querySelector('[data-mode="away"]').click()));
  await page.waitForFunction(() => window.__hq.db.events({ kind: 'system' }).some((e) => /^Alert state: AWAY \(by TESTER\)/.test(e.message)));
  check(true, 'alert state changed from the phone; the log says who (“Alert state: AWAY (by TESTER)”)');

  // ---- Two-step sign-in for the Director ----
  await page.click('[data-a2fa]');
  await page.fill('[data-2fa-begin] [name=pin]', '2468');
  await page.click('[data-2fa-begin] .btn-primary');
  await page.waitForSelector('[data-2fa-qr] svg');
  check(true, 'two-step set-up shows a QR code for the authenticator app');
  const secret = (await page.textContent('[data-2fa-key]')).replace(/\s/g, '');
  await page.fill('[data-2fa-enable] [name=code]', await code(secret));
  await page.click('[data-2fa-enable] .btn-primary');
  await page.waitForSelector('text=Two-step sign-in is on');
  await page.keyboard.press('Shift+L');
  await page.waitForSelector('[data-login]');
  await page.fill('[name=codename]', 'tester'); await page.fill('[name=pin]', '2468');
  await page.click('[data-login] button');
  await page.waitForSelector('[data-otpfield]:not([hidden])');
  check(true, 'after the PIN, sign-in asks for the 6-digit code');
  await page.fill('[name=otp]', '000000');
  await page.click('[data-login] button');
  await page.waitForSelector('text=That code is wrong');
  await page.fill('[name=otp]', await code(secret, 1)); // the app's next code
  await page.click('[data-login] button');
  await page.waitForSelector('[data-threat]');
  check(true, 'wrong code refused; a fresh code signs in');

  // ---- Operator notes (Records) ----
  await go(page, 'shift');
  await page.fill('[data-shiftform] textarea', 'Quiet evening. Back door checked at 22:00.');
  await page.check('[data-shiftform] [name=handover]');
  await page.click('[data-shiftform] .btn-primary');
  await page.waitForSelector('.shift-list .handover >> text=Unhandled alerts');
  check(true, 'note saved with an automatic summary of the situation');

  // ---- Sessions + audit ----
  await go(page, 'access');
  await page.waitForSelector('[data-sess]:has-text("My phone")');
  const sess = await page.textContent('[data-abody2]');
  check(sess.includes('Phone “My phone”') && sess.includes('this screen'), 'Sessions: where you are signed in');
  await page.click('[data-sess]:has-text("My phone") [data-aend]');
  await phone.waitForSelector('[data-login]', { timeout: 15000 });
  check(true, 'ending the phone’s session signs it out');
  await go(page, 'audit');
  await page.waitForSelector('.verify.ok');
  const audit = await page.textContent('[data-abody2]');
  check(audit.includes('Chain verified') && /Sign in/.test(audit) && audit.includes('Two-step sign-in enable') && audit.includes('Alert state changed') && audit.includes('Session ended'), 'Records › Audit log: sign-ins, 2FA, alert state, sessions — chain verified');
  check(audit.includes('Refused'), 'refused attempts are recorded too (the wrong 2FA code)');
  await shot('access-audit');
  const files = [];
  page.on('download', (d) => files.push(d.suggestedFilename()));
  await page.click('[data-aexport]');
  await page.waitForFunction(() => document.body.textContent.includes('SHA-256'));
  await page.waitForTimeout(500);
  check(files.some((f) => f.endsWith('.csv')) && files.some((f) => f.endsWith('.sha256')), `audit export with a checksum file (${files.join(', ')})`);
  // someone edits the stored trail → shown at once
  await page.evaluate(() => { window.__hq.db._auditRaw()[2].who = 'SOMEONE'; });
  await go(page, 'shift'); await go(page, 'audit');
  await page.waitForSelector('.verify.bad');
  check((await page.textContent('.verify.bad')).includes('Entry 3 has been changed'), 'tampering with the audit log is detected and pinpointed');

  await finish(browser, world, errors, 'access');
})().catch((e) => { console.error(e); process.exit(1); });
