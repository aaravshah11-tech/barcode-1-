// Redesign part 6: REPORTS — live SITREP, weekly report, custom report builder, PDF downloads.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startWorld, launch, openHQ, recruit, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  await api('PATCH', `/agents/${agent.id}`, { mission: 'motion' });
  await api('PATCH', '/settings', { mode: 'away' });
  await page.evaluate((id) => window.__hq.hq.agentEvent(id, { kind: 'motion', message: 'Motion detected' }), agent.id);
  await api('PATCH', '/settings', { mode: 'home' });
  const pdfOf = async (click) => { const [dl] = await Promise.all([page.waitForEvent('download'), click()]); const buf = fs.readFileSync(await dl.path()); return { name: dl.suggestedFilename(), buf }; };

  await page.keyboard.press('8');
  await page.waitForSelector('.sitrep h4');
  const sit = await page.textContent('.sitrep');
  check(sit.includes('1. Situation') && sit.includes('Alert state HOME') && sit.includes('3. Alerts and incidents') && /1 alert: 0 critical, 1 high/.test(sit), 'SITREP: numbered sections — situation, activity, alerts, equipment, actions');
  check(sit.includes('Handle 1 unhandled alert'), 'SITREP lists what needs doing');
  await shot('reports-sitrep');
  const s1 = await pdfOf(() => page.click('[data-rsitpdf]'));
  check(/^SITREP-\d{8}\.pdf$/.test(s1.name) && s1.buf.slice(0, 5).toString() === '%PDF-', `SITREP downloads as a PDF (${s1.name}, ${s1.buf.length} bytes)`);

  await page.click('[data-rtab="list"]');
  const w = await pdfOf(() => page.click('[data-rweekly]'));
  check(/^RPT-\d{4}-W\d{2}\.pdf$/.test(w.name), `weekly report with a reference number: ${w.name}`);
  await page.waitForSelector('[data-rid] >> text=Weekly security report');
  check(true, 'it is kept in the Reports list');

  await page.click('[data-rtab="build"]');
  await page.fill('[name=rtitle]', 'Evening check');
  await page.click('[data-rpreset="24h"]');
  await page.uncheck('[name=sec][value="network"]');
  await page.check('[name=sec][value="log"]');
  await page.selectOption('[name=minsev]', 'HIGH');
  await shot('reports-builder');
  const c = await pdfOf(() => page.click('[data-rbuild] .btn-primary'));
  const year = new Date().getFullYear();
  check(c.name === `RPT-${year}-0001.pdf`, `custom report builder → ${c.name}`);
  const rep = (await api('GET', '/reports')).find((r) => r.title === 'Evening check');
  check(rep && rep.sections.includes('log') && !rep.sections.includes('network') && rep.filter.minSeverity === 'HIGH', 'chosen sections and filters are kept with the report');
  await page.waitForSelector('[data-rid] >> text=Evening check');
  const again = await pdfOf(() => page.click('[data-rid]:has-text("Evening check") [data-rpdf]'));
  check(again.buf.length > 1500 && again.buf.slice(-6).toString().includes('%%EOF'), 'any report can be downloaded again as a PDF');
  await shot('reports-list');

  await finish(browser, world, errors, 'reports');
})().catch((e) => { console.error(e); process.exit(1); });
