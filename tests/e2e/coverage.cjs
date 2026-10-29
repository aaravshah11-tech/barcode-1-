// Redesign part 4: COVERAGE MAP (fields of view, blind spots, unwatched entries), TAMPER detection
// and the AGENT REGISTER.
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
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  await page.evaluate(async () => {
    const { TEMPLATES } = await import(new URL('../shared/house.js', location.href).href);
    await window.__hq.api('PUT', '/house', TEMPLATES.house.make());
  });
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, permissions: ['accelerometer', 'gyroscope'] }), world);
  agent.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  const f0 = (await api('GET', '/house')).floors[0];
  await api('PATCH', `/agents/${agent.id}`, { mission: 'motion' });
  await api('PUT', `/agents/${agent.id}/place`, { floorId: f0.id, x: 1.5, y: 4.8 });

  // ---- Coverage ----
  await page.keyboard.press('5');
  await page.waitForSelector('.cov-svg svg .cv-fov');
  check(true, 'Coverage view: the camera’s field of view is drawn on the plan');
  const side = await page.textContent('[data-cside]');
  check(/\d+%/.test(await page.textContent('.cov-big')) && side.includes('Blind spots') && side.includes('Living room'), 'summary: % of floor watched, blind-spot rooms listed');
  check(!side.includes('Door — Hall'), 'the camera in the hall faces the front door: it is watched');
  check(side.includes('Window — Kitchen'), 'unwatched entry points are listed (kitchen window)');
  await shot('coverage');
  await page.selectOption('[data-cagent] [data-cdir]', '0');
  await page.waitForFunction(() => document.querySelector('[data-cside]').textContent.includes('Door — Hall'));
  check(true, 'turn the camera to face up → the front door becomes “not watched”');
  await page.click('[data-cagent] [data-crot="15"]');
  await page.waitForFunction(() => window.__hq.hq.db.agents()[0].place.dir === 15);
  check(true, '⟳ turns it 15° (saved on HQ)');

  // ---- Tamper: pick up the Agent phone ----
  check(!(await agent.p.$('[data-tamperperm]')), 'motion sensor allowed: move alerts are on without a tap');
  await agent.p.evaluate(async () => {
    const fire = (x, y, z) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y, z } }));
    for (let i = 0; i < 50; i++) { fire(0, 9.8, 0); await new Promise((r) => setTimeout(r, 100)); }
    for (let i = 0; i < 25; i++) { fire(0, 0, 9.8); await new Promise((r) => setTimeout(r, 100)); }
  });
  await page.waitForFunction(() => window.__hq.hq.ops.alerts().some((a) => a.source === 'tamper' && /^Agent moved/.test(a.title)), null, { timeout: 10000 });
  check(true, 'Agent phone picked up and laid flat → “Agent moved” tamper alert in Triage');
  // HQ-side: unplugged
  await page.evaluate((id) => { const hq = window.__hq.hq; hq.agentStatus(id, { charging: true, battery: 0.8 }); hq.agentStatus(id, { charging: false, battery: 0.8 }); }, agent.id);
  await page.waitForFunction(() => window.__hq.hq.ops.alerts().some((a) => /^Agent unplugged/.test(a.title)));
  check(true, 'charger pulled → “Agent unplugged” alert');

  // ---- Agent register ----
  await page.keyboard.press('6');
  await page.waitForSelector('.reg-table [data-reg]');
  const row = await page.textContent('.reg-table [data-reg]');
  check(row.includes('AGENT-01') && row.includes('Chrome') && row.toUpperCase().includes('MOTION WATCH') && row.includes('Hall') && /\d+(\.\d)?%/.test(row), 'register: hardware, mission, location, uptime %');
  check(/moved|unplugged/.test(row), 'last tamper shown');
  await page.click('.reg-table [data-reg]');
  await page.waitForSelector('.reg-detail');
  check(/STANDBY/i.test(await page.textContent('.reg-detail')) && /MOTION WATCH/i.test(await page.textContent('.reg-detail')), 'mission history: Standby → Motion Watch');
  await page.fill('[data-regnotes] textarea', 'Charger on the hall shelf');
  await page.click('[data-regcal]');
  await page.waitForFunction(() => document.querySelector('.reg-table [data-reg]')?.textContent.includes('Charger on the hall shelf'));
  check(!(await page.textContent('.reg-table [data-reg]')).includes('never'), 'Mark calibrated now + maintenance notes saved');
  await shot('register');

  await finish(browser, world, errors, 'coverage');
})().catch((e) => { console.error(e); process.exit(1); });
