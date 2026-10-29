// Redesign part 2: the TRIAGE QUEUE (acknowledge / escalate / dismiss with a reason / convert) and
// INCIDENTS (INC-YYYY-NNNN, status flow, assignee, notes, timeline, playback on the map).
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

  // A house with one Agent watching the kitchen
  await page.evaluate(async () => {
    const { TEMPLATES } = await import(new URL('../shared/house.js', location.href).href);
    await window.__hq.api('PUT', '/house', TEMPLATES.house.make());
  });
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  agent.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  const f0 = (await api('GET', '/house')).floors[0];
  await api('PUT', `/agents/${agent.id}/place`, { floorId: f0.id, x: 7, y: 2 });
  await api('PATCH', `/agents/${agent.id}`, { mission: 'motion' });
  const motion = () => page.evaluate((id) => window.__hq.hq.agentEvent(id, { kind: 'motion', message: 'Motion detected' }), agent.id);

  // Home: activity is only logged
  await motion();
  await page.waitForTimeout(300);
  check((await page.textContent('[data-minique]')).includes('No unhandled alerts'), 'HOME: motion is logged, not queued for triage');

  // AWAY: motion → HIGH alert in the Operations queue panel and on the rail
  await api('PATCH', '/settings', { mode: 'away' });
  await motion();
  await page.waitForSelector('[data-minique] .sev-HIGH');
  check((await page.textContent('[data-minique]')).includes('Motion detected — Kitchen'), 'AWAY: motion → HIGH alert “Motion detected — Kitchen” in the Alert queue panel');
  check(await page.isVisible('[data-badge="triage"].crit') && (await page.textContent('[data-badge="triage"]')) === '1', 'Triage rail button shows 1 unhandled (red: HIGH)');
  await motion();
  await page.waitForSelector('[data-minique] >> text=×2');
  check(true, 'a repeat within a minute merges into the same alert (×2)');

  // Triage view
  await page.keyboard.press('2');
  await page.waitForSelector('.triage-table [data-aid]');
  const row = await page.textContent('.triage-table tbody');
  check(/ALT-\d{6}/.test(row) && row.includes('HIGH') && row.includes('Kitchen') && row.includes('AGENT-01'), 'queue row: severity, reference, alert, source Agent, room, time');
  check(/AWAY/.test(row), 'the alert explains why (activity while AWAY)');
  check(/<1 min|\d+ min/.test(await page.textContent('[data-age]')), 'shows how long it has been waiting');
  await shot('triage-queue');
  // keyboard: ↓ then A = acknowledge
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('.triage-table tr.sel');
  await page.keyboard.press('a');
  await page.waitForSelector('.triage-table [data-aid]', { state: 'detached' });
  check(true, 'keyboard: ↓ selects, A acknowledges (it leaves the Unhandled list)');
  await page.click('[data-tfilter="open"]');
  await page.waitForSelector('.triage-table >> text=Acknowledged');
  check((await page.textContent('.triage-table')).includes('Acknowledged'), 'Open filter: still open, marked Acknowledged');
  // Escalate
  await page.click('.triage-table [data-tact="escalate"]');
  await page.waitForSelector('.triage-table .sev-CRITICAL');
  check(true, 'Escalate raises it to CRITICAL');
  // Dismiss with a reason
  await page.click('.triage-table [data-tact="dismiss"]');
  await page.waitForSelector('.sheet [data-dismissform]');
  await page.check('.sheet input[value="Expected activity (household member)"]');
  await page.fill('.sheet [name=note]', 'Dad back early');
  await page.click('.sheet .btn-primary');
  await page.click('[data-tfilter="dismissed"]');
  await page.waitForSelector('.triage-table >> text=Dismissed: Expected activity (household member)');
  check(true, 'Dismiss asks for a reason; it is kept with the alert');
  check(await page.evaluate(() => window.__hq.db.events({ kind: 'triage' }).some((e) => /dismissed \(Expected activity/.test(e.message) && /by TESTER/.test(e.message))), 'every decision is written in the log with who made it');

  // Convert to incident
  await motion();
  await page.click('[data-tfilter="new"]');
  await page.waitForSelector('.triage-table [data-tact="incident"]');
  await page.click('.triage-table [data-tact="incident"]');
  await page.waitForSelector('.sheet [data-incform]');
  await page.fill('.sheet [name=incTitle]', 'Movement in kitchen while away');
  await page.fill('.sheet [name=note]', 'Nobody should be home.');
  await page.click('.sheet .btn-primary');
  await page.waitForSelector('[data-idetail] >> text=Movement in kitchen while away', { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('[data-idetail] [name=ititle]')?.value === 'Movement in kitchen while away');
  const year = new Date().getFullYear();
  check((await page.textContent('[data-idetail]')).includes(`INC-${year}-0001`), `Convert to incident → INC-${year}-0001 opens in Incidents`);
  check((await page.textContent('[data-idetail]')).includes('Nobody should be home.'), 'first note saved');
  check(/ALT-\d{6}/.test(await page.textContent('[data-idetail] .grid-table')), 'linked alert listed');
  check(await page.textContent('.stepper .now') === 'Open', 'status: Open');
  // Status flow, assignee, notes
  await page.click('[data-imove="investigating"]');
  await page.waitForFunction(() => document.querySelector('.stepper .now')?.textContent === 'Investigating');
  check(true, 'Start investigating → Investigating');
  await page.fill('[data-iassign]', 'Mum');
  await page.press('[data-iassign]', 'Tab');
  await page.waitForSelector('.timeline >> text=Assigned to Mum');
  check(true, 'assignee changed (on the timeline)');
  await page.fill('[data-inote] textarea', 'Checked the back door — locked.');
  await page.click('[data-inote] button');
  await page.waitForSelector('.notes >> text=Checked the back door — locked.');
  check(true, 'notes can be added');
  await page.click('[data-imove="resolved"]');
  await page.waitForFunction(() => document.querySelector('.stepper .now')?.textContent === 'Resolved');
  const tl = await page.textContent('.timeline');
  check(tl.includes('Incident opened') && tl.includes('Open → Investigating') && tl.includes('Investigating → Resolved') && tl.includes('Motion detected'), 'timeline: case history and the alert’s sensor events, in order');
  check((await page.textContent('[data-badge="incidents"]').catch(() => '')) === '' || await page.isHidden('[data-badge="incidents"]'), 'resolved incidents no longer count as active');
  await shot('incident');

  // Playback on the map
  await page.click('[data-iplay]');
  await page.waitForSelector('[data-replaybar]:not([hidden]) >> text=Replay · INC-');
  check(true, 'Play back on map → Operations, replaying just the incident window');
  await page.waitForTimeout(800);
  await shot('incident-playback');

  // Linked phones see the same queue (server-side state)
  const st = await api('GET', '/state');
  check(st.alerts.length >= 2 && st.incidents.length === 1, 'alerts and incidents are kept by HQ (phones get them too)');

  await finish(browser, world, errors, 'triage');
})().catch((e) => { console.error(e); process.exit(1); });
