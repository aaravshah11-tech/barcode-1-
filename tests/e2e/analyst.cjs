// v3 phase 7: the Analyst — automatic summaries without a model, plain-English search, a (fake) local
// Ollama with read-only tools, cited evidence that links to the record, and suggestions you must confirm.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, hqApi, check, finish, go } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);

  await api('PATCH', '/settings', { mode: 'away' });
  await page.evaluate(() => {
    const hq = window.__hq.hq;
    hq.logEvent({ kind: 'perimeter', level: 'alert', message: 'Person detected (garden)', data: { class: 'person', zone: 'garden', armed: 'away' } });
    hq.logEvent({ kind: 'perimeter', message: 'Animal detected (garden)', data: { class: 'animal', zone: 'garden' } });
  });
  const alert = (await api('GET', '/alerts')).find((a) => /Person|perimeter|Perimeter/.test(a.title)) || (await api('GET', '/alerts'))[0];

  // ---------- without a model ----------
  await go(page, 'analyst');
  await page.waitForSelector('[data-anstatus] [data-anset]');
  check(/OFF/.test(await page.textContent('[data-anstatus]')), 'model switched off by default');
  await page.fill('[data-ansearch] input', 'people in the garden today');
  await page.click('[data-ansearch] button');
  await page.waitForSelector('[data-ansresults] .an-results li');
  const res = await page.textContent('[data-ansresults]');
  check(/Understood as: people in the garden/.test(res) && /1 match/.test(res), 'plain-English search: “people in the garden today” → 1 match (not the animal)');
  await page.fill('[data-anform] input', 'animals in the garden today');
  await page.click('[data-anform] .btn-primary');
  await page.waitForFunction(() => /Automatic answer/.test(document.querySelector('[data-anlog]').textContent));
  check(/1 match/.test(await page.textContent('[data-anlog]')), 'without a model: an automatic answer from the log, clearly marked');

  // ---------- a local model (faked here) ----------
  const seen = [];
  await page.route('http://localhost:11434/**', async (route) => {
    const req = route.request(), url = req.url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.endsWith('/api/tags')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }) });
    const body = JSON.parse(req.postData());
    seen.push(body);
    const last = body.messages.at(-1);
    const reply = last.role === 'user'
      ? { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_alerts', arguments: { hours: 12 } } }] } }
      : { message: { role: 'assistant', content: `A person was seen in the garden while the house was empty [${alert.id}].\nPROPOSE: mode night` } };
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.check('[data-anset] [name=on]');
  await page.click('[data-anset] .btn-primary');
  await page.waitForFunction(() => /CONNECTED/.test(document.querySelector('[data-anstatus]').textContent), null, { timeout: 15000 });
  check(true, 'Ollama found on this computer: CONNECTED, model listed');
  await page.fill('[data-anform] input', 'What happened while we were out?');
  await page.click('[data-anform] .btn-primary');
  await page.waitForSelector(`[data-anlog] .ref[data-ref="${alert.id}"]`, { timeout: 15000 });
  const ans = await page.textContent('[data-anlog] .an-item');
  check(/llama3\.1:8b/.test(ans) && /looked at: get_alerts/.test(ans), 'answer names the model and the read-only tool it used');
  check(seen[0].tools.every((t) => t.function.name.startsWith('get_') || t.function.name === 'search_log'), 'only read-only tools are offered to the model');
  check(await page.isVisible('[data-anprop="0:0"]') && (await page.textContent('[data-anprop="0:0"]')) === 'Switch to NIGHT', 'a suggestion becomes a button — nothing changes on its own');
  check((await api('GET', '/state')).settings.mode === 'away', 'the Alert State is unchanged until you confirm');
  await shot('hq-analyst');
  await page.click('[data-anprop="0:0"]');
  await page.click('[data-ok]');
  await page.waitForFunction(async () => (await window.__hq.api('GET', '/state')).settings.mode === 'night');
  check(true, 'you confirm → Alert State NIGHT (recorded as your action)');
  await page.click(`[data-anlog] .ref[data-ref="${alert.id}"]`);
  await page.waitForSelector(`[data-viewroot][data-view="triage"] tr.sel[data-aid="${alert.id}"]`);
  check(true, 'the cited reference opens the evidence in Triage');
  await go(page, 'analyst');
  await page.click('[data-anpic] [data-ankind="picture"]');
  await page.waitForFunction(() => /Analyst · llama3\.1:8b/.test(document.querySelector('[data-anpic]').textContent), null, { timeout: 15000 });
  check(true, 'Current Picture written by the Analyst');
  await go(page, 'ops');
  await page.waitForFunction(() => /Analyst ·/.test(document.querySelector('.pic-src')?.textContent || ''));
  check(!/\[ALT-/.test(await page.textContent('[data-picture]')), 'Operations Floor shows the Analyst’s picture (references kept for the Analyst view)');

  const inc = await api('POST', '/incidents', { alertIds: [alert.id], title: 'Garden intrusion' });
  await page.evaluate(() => window.__go('incidents'));
  await page.click('.inc-row, [data-iid]').catch(() => {});
  await page.waitForSelector('[data-anask="incident"]', { timeout: 10000 });
  await page.click('[data-anask="incident"]');
  await page.waitForFunction((ref) => [...document.querySelectorAll('[data-anlog] .an-q')].some((q) => /Incident summary/.test(q.textContent)), inc.ref, { timeout: 15000 });
  check(true, 'Casework: Summarise sends the incident to the Analyst');
  await finish(browser, world, errors, 'analyst');
})().catch((e) => { console.error(e); process.exit(1); });
