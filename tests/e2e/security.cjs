// Security modes: HOME / AWAY / NIGHT / LOCKDOWN, night arming per Agent, alarm protocol on Agents,
// PANIC, stand down, and mode suggestions.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  agent.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  await api('PATCH', `/agents/${agent.id}`, { mission: 'panel', name: 'Hallway' });
  const knock = () => page.evaluate((id) => window.__hq.hq.agentEvent(id, { kind: 'knock', message: 'Door panel pressed at Hallway' }), agent.id);
  const lastLevel = () => page.evaluate(() => window.__hq.db.events({ kind: 'knock' })[0]?.level);

  // HOME: logged only
  check((await page.textContent('.secmode')).includes('Home'), 'Security panel shows HOME and what it means');
  await knock();
  check(await lastLevel() === 'info', 'HOME: a sensor going off is logged, not an alarm');

  // NIGHT
  await page.click('.presence [data-mode="night"]');
  await page.waitForSelector('.secmode.m-night');
  await page.waitForSelector('[data-log] >> text=Security mode: NIGHT');
  check(true, 'switch to NIGHT from the top bar (logged)');
  await knock();
  await page.waitForSelector('[data-threat].RED');
  check(await lastLevel() === 'alert', 'NIGHT: an armed Agent raises THREAT RED');
  await page.click(`[data-agent="${agent.id}"]`);
  await page.uncheck('[data-nightarmed]');
  await page.waitForSelector('text=not armed at night');
  await page.keyboard.press('Escape');
  await knock();
  check(await lastLevel() === 'info', 'NIGHT: untick “Armed in NIGHT mode” (bedroom) → only logged');
  await shot(page, 'security-night');

  // LOCKDOWN (with confirmation) → Agents flash
  await page.click('.presence [data-mode="lockdown"]');
  await page.click('.sheet [data-ok]');
  await page.waitForSelector('.secmode.m-lockdown');
  await agent.p.waitForSelector('.alarm-screen >> text=LOCKDOWN', { timeout: 10000 });
  check(true, 'LOCKDOWN (after confirming): every Agent flashes red');
  check(await agent.p.isVisible('[data-banner]'), 'the SENTINEL AGENT ACTIVE banner stays visible over the alarm');
  await shot(agent.p, 'agent-alarm');
  await knock();
  await agent.p.waitForSelector('.alarm-screen >> text=INTRUSION', { timeout: 10000 });
  check(await lastLevel() === 'alert', 'LOCKDOWN: even the unarmed Agent counts — alarm “INTRUSION — Hallway” on the Agents');
  await shot(page, 'security-lockdown');
  await page.click('[data-standdown]');
  await agent.p.waitForSelector('.alarm-screen', { state: 'detached', timeout: 10000 });
  check(true, 'Stand down alarm stops it on the Agents');

  // Back to HOME, then PANIC
  await page.click('.presence [data-mode="home"]');
  await page.waitForSelector('.secmode.m-home');
  await page.click('[data-panic]');
  await page.click('.sheet [data-ok]');
  await page.waitForSelector('.secmode.m-lockdown');
  await page.waitForSelector('[data-log] >> text=PANIC raised by HQ');
  await agent.p.waitForSelector('.alarm-screen >> text=PANIC', { timeout: 10000 });
  check(true, 'PANIC → LOCKDOWN at once, logged, every Agent alerted');
  await page.click('[data-standdown]');
  await page.click('.presence [data-mode="home"]');
  await agent.p.waitForSelector('.alarm-screen', { state: 'detached', timeout: 10000 });

  // Suggestion: night hours that include now
  const now = new Date(), hh = (d) => d.toTimeString().slice(0, 5);
  await api('PATCH', '/settings', { nightStart: hh(new Date(now - 3600e3)), nightEnd: hh(new Date(+now + 3600e3)) });
  await page.waitForSelector('.suggest >> text=switch to NIGHT');
  await page.click('.suggest [data-mode="night"]');
  await page.waitForSelector('.secmode.m-night');
  check(true, 'late in the evening HQ suggests NIGHT; one click switches');

  // Alarm settings + test
  await page.click('[data-settings]');
  await page.click('[data-tab="security"]');
  await page.fill('[data-alarm] [name=seconds]', '12');
  await page.click('[data-alarm] .btn-primary');
  await page.waitForSelector('text=Alarm protocol saved');
  check((await api('GET', '/state')).settings.alarm.seconds === 12, 'Settings › Security: alarm protocol saved');
  await page.click('[data-testalarm]');
  await agent.p.waitForSelector('.alarm-screen >> text=ALARM TEST', { timeout: 10000 });
  check(true, '“Test on all Agents” flashes the alarm on the Agents');
  await agent.p.waitForSelector('.alarm-screen', { state: 'detached', timeout: 10000 });
  check(true, 'the test alarm ends by itself after 4 s');

  await finish(browser, world, errors, 'security modes');
})().catch((e) => { console.error(e); process.exit(1); });
