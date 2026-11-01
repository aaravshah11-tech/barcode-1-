// v3 phase 5: Info / Advisory / Alert / Critical, context grading, the visual grading-rule builder, snooze,
// alert load (fatigue), daily digest, On Watch, notifications and quiet hours.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, hqApi, check, finish, go } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.grantPermissions(['notifications']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  await api('PATCH', '/settings', { mode: 'away', quiet: { on: false, from: '23:00', to: '07:00' } });
  // an armed sensor event, as an Agent would send it
  const armed = (msg = 'Motion detected') => page.evaluate((m) => window.__hq.hq.logEvent({ kind: 'motion', level: 'alert', message: m, data: { armed: 'away' } }), msg);
  const alerts = () => api('GET', '/alerts');

  // ---------- the visual grading-rule builder ----------
  await go(page, 'analysis');
  await page.click('[data-atab="grading"]');
  await page.click('[data-gnew]');
  await page.fill('[data-gform] [name=name]', 'Motion is routine');
  await page.selectOption('[data-gform] [name=kind]', 'motion');
  await page.selectOption('[data-gform] [name=action]', 'set');
  await page.selectOption('[data-gform] [name=severity]', 'INFO');
  check((await page.textContent('[data-gdesc]')) === 'Motion → Info', 'builder shows the rule in plain English: “Motion → Info”');
  await shot('hq-grading-builder');
  await page.click('[data-gform] .btn-primary');
  await page.waitForSelector('[data-gid]');
  check((await page.textContent('[data-gid]')).includes('Motion is routine'), 'grading rule listed');
  await page.selectOption('[data-gtry] [name=kind]', 'motion');
  await page.click('[data-gtry] button');
  await page.waitForFunction(() => /Info/.test(document.querySelector('[data-gtryout]').textContent));
  check(/Your rule “Motion is routine”/.test(await page.textContent('[data-gtryout]')), 'Try it: grades a sample and explains why');

  await armed('Motion A');
  let a = (await alerts()).find((x) => /Motion detected/.test(x.title));
  check(a && a.severity === 'INFO' && /Your rule/.test(a.explanation), `your rule lowers an armed motion to Info (got ${a?.severity})`);
  check(await page.isHidden('[data-badge="triage"]'), 'Info doesn’t count as waiting (no red badge)');
  const rid = (await api('GET', '/graderules'))[0].id;
  await api('DELETE', `/graderules/${rid}`);
  await armed('Hall motion');
  await page.waitForFunction(() => window.__hq.hq.ops.alerts().some((x) => x.severity === 'ALERT'));
  check(true, 'rule deleted: the same event is an Alert again');

  // ---------- notifications: On Watch, quiet hours, Critical always ----------
  await page.click('[data-onwatch]');
  check(/ON WATCH/.test(await page.textContent('.strip')), 'On Watch shows in the status strip');
  await page.evaluate(() => window.__hq.hq.ops.raise({ severity: 'ALERT', title: 'Back door opened', kind: 'door' }));
  await page.waitForFunction(() => window.__alertsSent.some((x) => x.severity === 'ALERT'));
  check(true, 'On Watch: an Alert becomes a notification on this device');
  const h = new Date().getHours(), pad = (n) => String(n).padStart(2, '0');
  await api('PATCH', '/settings', { quiet: { on: true, from: `${pad(h)}:00`, to: `${pad((h + 2) % 24)}:00` } });
  const before = await page.evaluate(() => window.__alertsSent.length);
  await page.evaluate(() => window.__hq.hq.ops.raise({ severity: 'ALERT', title: 'Garage door opened', kind: 'door' }));
  await page.waitForTimeout(500);
  check(await page.evaluate((n) => window.__alertsSent.length === n, before), 'quiet hours: an Alert makes no notification');
  await page.evaluate(() => window.__hq.hq.ops.raise({ severity: 'CRITICAL', title: 'PANIC test', kind: 'system' }));
  await page.waitForFunction(() => window.__alertsSent.some((x) => x.severity === 'CRITICAL'));
  check(true, 'quiet hours: Critical always gets through');
  await page.click('[data-onwatch]');
  await api('PATCH', '/settings', { quiet: { on: false, from: '23:00', to: '07:00' } });

  // ---------- snooze, alert load, digest ----------
  await go(page, 'triage');
  await page.click('[data-tfilter="all"]');
  const row = page.locator('[data-aid]', { hasText: 'Motion detected' }).filter({ hasText: 'Unhandled' }).first();
  await row.locator('[data-tact="snooze"]').click();
  await page.click('[data-snzform] .btn-primary');
  await page.waitForSelector('[data-unsnooze]');
  check((await page.textContent('[data-taux]')).includes('Motion detected'), 'snooze listed above the queue with its end time');
  const n = (await alerts()).length;
  await armed('Hall motion again');
  await page.waitForTimeout(400);
  check((await alerts()).length === n, 'while snoozed, a repeat raises no new alert…');
  check((await api('GET', '/log?kind=triage&limit=20')).some((e) => /^Held back \(snoozed\)/.test(e.message)), '…but it is still written in the log');
  check(/a day/.test(await page.textContent('[data-taux]')) && /false alarms/.test(await page.textContent('[data-taux]')), 'alert load card: alerts a day and false-alarm rate');
  await shot('hq-triage-phase5');
  await page.click('[data-unsnooze]');
  await page.waitForFunction(() => !document.querySelector('[data-unsnooze]'));
  check(true, 'snooze ended early');
  await page.click('[data-digest]');
  await page.waitForFunction(async () => (await window.__hq.api('GET', '/digest')).length === 1);
  const dg = (await api('GET', '/digest'))[0];
  check(/alerts? in the last 24 hours/.test(dg.lines[0]) && /held back/.test(dg.lines[1]), 'daily digest: last 24 h counts and what was held back');
  check(/^(ALERT|INFO|ADVISORY|CRITICAL)$/.test((await alerts())[0].severity), 'severities are Info / Advisory / Alert / Critical');

  await finish(browser, world, errors, 'alerts');
})().catch((e) => { console.error(e); process.exit(1); });
