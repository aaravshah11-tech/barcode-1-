// Offline test: load once with the service worker, go offline, reload and open every tool.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '#/');
  await p.waitForSelector('.menu-grid');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('homebase-')) && (await (await caches.open((await caches.keys()).find((k) => k.startsWith('homebase-')))).keys()).length > 70, null, { timeout: 20000 });
  check(true, 'whole app cached for offline use');
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForSelector('.menu-grid');
  check(await p.isVisible('#offline-pill'), 'opens offline (offline badge shown)');
  for (const [route, sel] of [['library', '.lib-head'], ['inventory', '.lib-head'], ['sports', '.sport-grid'], ['photo', '.clock-card'], ['golf', '[data-ready]'], ['settings', '.list'], ['sports/new/rugby', '[data-form]']]) {
    await p.goto(BASE + '#/' + route);
    await p.waitForSelector(sel, { timeout: 8000 }).then(() => check(true, `${route} works offline`), () => check(false, `${route} works offline`));
  }
  await p.evaluate(async () => (await import('./js/core/store.js')).put('items', { name: 'Offline torch' }));
  check(true, 'saving works offline');
  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll offline checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
