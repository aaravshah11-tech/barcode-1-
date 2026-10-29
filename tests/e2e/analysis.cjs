// Redesign part 3: CORRELATION RULES (editable) and PATTERN-OF-LIFE anomalies.
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
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const kitchen = await recruit(page, ctxA, world);
  const hall = await recruit(page, ctxA, world);
  const f0 = (await api('GET', '/house')).floors[0];
  await api('PUT', `/agents/${kitchen.id}/place`, { floorId: f0.id, x: 7, y: 2 });
  await api('PUT', `/agents/${hall.id}/place`, { floorId: f0.id, x: 1.5, y: 6 });

  // ---- Correlation: door → hall motion → Mum's phone = ARRIVAL ----
  await page.evaluate(({ h }) => {
    const hq = window.__hq.hq;
    hq.logEvent({ kind: 'door', agentId: h, message: 'AGENT-02 HALL: Front door opened' });
    hq.logEvent({ kind: 'motion', agentId: h, message: 'AGENT-02 HALL: Motion detected' });
    hq.deviceSeen({ id: 'viewer:test', label: 'Mum’s iPhone', owner: 'Mum' });
  }, { h: hall.id });
  await page.waitForSelector('[data-log] >> text=/ARRIVAL \\(likely: Mum\\)/');
  check(true, 'door → hall motion → Mum’s phone within 60 s → “ARRIVAL (likely: Mum)” in the log');
  check(await page.evaluate(() => !window.__hq.hq.ops.alerts().some((a) => a.source === 'correlation')), 'ARRIVAL is INFO: logged, not sent to Triage');

  await page.keyboard.press('4');
  await page.waitForSelector('.rules-table [data-rid="rule-arrival"]');
  const rules = await page.textContent('.rules-table');
  check(rules.includes('Arrival') && rules.includes('Entry while unoccupied') && rules.includes('Door sensor “open”') && rules.includes('Phone / device appears'), 'Analysis › Correlation rules lists the example rules and their sequences');
  check((await page.textContent('.match-list')).includes('ARRIVAL (likely: Mum)'), 'recent matches listed');

  // ---- A new rule from the editor ----
  await page.click('[data-anew]');
  await page.waitForSelector('[data-ruleform]');
  await page.fill('[name=rname]', 'Kitchen then hall');
  const steps = await page.$$('[data-step]');
  await steps[0].$eval('[data-sfsignal]', (s) => { s.value = 'motion'; });
  await steps[0].$eval('[data-sftext]', (s) => { s.value = ''; });
  const pick = (step, name) => step.$eval('[data-sfwhere]', (sel, n) => { sel.value = [...sel.options].find((o) => o.textContent.startsWith(n)).value; }, name);
  await pick(steps[0], 'Kitchen');
  await pick(steps[1], 'Hall');
  await page.fill('[name=window]', '20');
  await page.fill('[name=label]', 'walking through');
  await page.selectOption('[name=level]', 'MEDIUM');
  await page.click('[data-rtest]');
  await page.waitForSelector('[data-testout] >> text=Would have matched');
  check(true, 'Test on last 7 days: dry run shows how often it would have matched');
  await shot('analysis-rule-editor');
  await page.click('[data-ruleform] .btn-primary');
  await page.waitForSelector('.rules-table >> text=Kitchen then hall');
  check((await page.textContent('.rules-table')).includes('WALKING THROUGH'), 'new rule saved (conclusion in capitals)');
  await page.evaluate(({ k, h }) => {
    const hq = window.__hq.hq;
    hq.logEvent({ kind: 'motion', agentId: k, message: 'AGENT-01 KITCHEN: Motion detected' });
    hq.logEvent({ kind: 'motion', agentId: h, message: 'AGENT-02 HALL: Motion detected' });
  }, { k: kitchen.id, h: hall.id });
  await page.waitForFunction(() => window.__hq.hq.ops.alerts().some((a) => a.source === 'correlation' && /^WALKING THROUGH/.test(a.title) && a.severity === 'MEDIUM'));
  check(true, 'kitchen motion then hall motion within 20 s → MEDIUM alert in Triage');
  // switch it off
  await page.uncheck('.rules-table tr:has-text("Kitchen then hall") [data-ron]');
  await page.waitForFunction(() => window.__hq.hq.analytics.rules().find((r) => r.name === 'Kitchen then hall')?.enabled === false);
  check(true, 'a rule can be switched off');
  await shot('analysis-rules');

  // ---- Pattern of life: two weeks where the kitchen is never used at this hour ----
  await page.evaluate(({ k }) => {
    const db = window.__hq.db, now = new Date(), mid = new Date(now); mid.setHours(0, 0, 0, 0);
    const busy = [(now.getHours() + 8) % 24, (now.getHours() + 14) % 24];
    for (let d = 14; d >= 1; d--) for (const h of busy) for (let i = 0; i < 3; i++) db.addEvent({ ts: mid.getTime() - d * 86400000 + h * 3600000 + i * 300000, kind: 'motion', agentId: k, message: 'AGENT-01 KITCHEN: Motion detected' });
  }, { k: kitchen.id });
  await page.click('[data-atab="pattern"]');
  await page.click('[data-arebuild]');
  await page.waitForSelector('.pol-status >> text=Baseline active');
  check((await page.textContent('.pol-status')).includes('14 of 14 days'), 'Pattern of life: 14 days learned, baseline active');
  check((await page.textContent('.pol-table')).includes('Kitchen'), 'hour-by-hour chart per room (weekdays / weekends)');
  await page.evaluate(({ k }) => window.__hq.hq.logEvent({ kind: 'motion', agentId: k, message: 'AGENT-01 KITCHEN: Motion detected' }), { k: kitchen.id });
  await page.waitForSelector('.analysis table >> text=Unusual activity — Kitchen');
  const an = await page.evaluate(() => window.__hq.hq.ops.alerts().find((a) => a.source === 'anomaly'));
  check(an && /Confidence \d+%/.test(an.explanation) && /normally quiet/.test(an.explanation), `anomaly → Triage with the reason and a confidence % (${an?.explanation})`);
  await shot('analysis-pattern');

  await finish(browser, world, errors, 'analysis');
})().catch((e) => { console.error(e); process.exit(1); });
