// Quick-link pairing speed and robustness: a blocked relay, lost first messages, the "taking a while" tip.
// Needs the app on :8080 and test relays on :8888/:8889 (npm run test:e2e -- link starts them).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

// One working relay, one "blocked" (nothing listening), one working relay that needs a username/password.
const RELAYS = ['ws://127.0.0.1:8888', 'ws://127.0.0.1:8899', { url: 'ws://127.0.0.1:8889', username: 'public', password: 'public' }];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts, { relays = RELAYS, dropFirst = 0 } = {}) => {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript(({ relays, dropFirst }) => {
      localStorage.setItem('shelf.relays', JSON.stringify(relays));
      // Simulate a flaky relay: the first few messages this device sends are lost.
      let dropped = 0, lib;
      Object.defineProperty(window, 'mqtt', {
        configurable: true,
        get: () => lib,
        set: (v) => {
          lib = { ...v, connect: (...a) => { const c = v.connect(...a); const pub = c.publish.bind(c); c.publish = (...p) => (dropped++ < dropFirst ? undefined : pub(...p)); return c; } };
        },
      });
    }, { relays, dropFirst });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return page;
  };

  const comp = await mk({ viewport: { width: 1280, height: 820 } });
  const phone = await mk({ viewport: { width: 390, height: 844 }, isMobile: true }, { dropFirst: 4 });
  await comp.goto(BASE + '?nosw#/settings/pair');
  await comp.click('[data-relay-host]');
  await comp.waitForSelector('[data-qr] svg');
  await comp.waitForSelector('text=/2 of 3 relays connected/', { timeout: 10000 });
  check(true, 'computer: a blocked relay doesn’t hold things up (2 of 3 connected)');
  const link = await comp.evaluate(async () => (await import('./js/sync/manager.js')).pairingUrl());
  const t0 = Date.now();
  await phone.goto(link.replace('http://127.0.0.1:8080/', BASE + '?nosw'));
  await phone.waitForSelector('text=Linked with', { timeout: 20000 });
  await comp.waitForSelector('text=Linked with', { timeout: 20000 });
  const secs = (Date.now() - t0) / 1000;
  check(secs < 8, `paired in ${secs.toFixed(1)} s even though the phone’s first 4 messages were lost (was up to 25 s+)`);
  await phone.evaluate(async () => (await import('./js/core/store.js')).put('books', { id: 'lk1', title: 'Linked Book' }));
  await comp.waitForFunction(async () => !!(await import('./js/core/store.js')).get('books', 'lk1'), null, { timeout: 10000 });
  check(true, 'book added on the phone reaches the computer');
  const redraws = await comp.evaluate(() => new Promise((r) => { let n = 0; const o = new MutationObserver(() => n++); o.observe(document.querySelector('#view'), { childList: true, subtree: true }); setTimeout(() => { o.disconnect(); r(n); }, 4500); }));
  check(redraws === 0, `pairing screen sits still while linked (${redraws} redraws in 4.5 s)`);

  // One-click "Pair phone" button in the top bar (fresh computer + phone)
  const comp2 = await mk({ viewport: { width: 1280, height: 820 } }, { relays: ['ws://127.0.0.1:8888', 'ws://127.0.0.1:8889'] });
  const phone2 = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, { relays: ['ws://127.0.0.1:8888', 'ws://127.0.0.1:8889'] });
  await comp2.goto(BASE + '?nosw#/library');
  await comp2.waitForSelector('#pair-btn:not([hidden])');
  check((await comp2.textContent('#pair-btn')).includes('Pair phone'), 'computer: “Pair phone” button in the top bar on every screen');
  await comp2.click('#pair-btn');
  await comp2.waitForSelector('.pair-sheet [data-qr] svg', { timeout: 10000 });
  check(/^[A-Z0-9]{5} [A-Z0-9]{5}$/.test((await comp2.textContent('.pair-sheet [data-code]')).trim()), 'one click shows the QR code (and the typed code)');
  await phone2.goto(BASE + '?nosw#/');
  await phone2.waitForSelector('.menu-grid');
  check(await phone2.isHidden('#pair-btn'), 'phone: no “Pair phone” button (it scans instead)');
  const link2 = await comp2.evaluate(async () => (await import('./js/sync/manager.js')).pairingUrl());
  await phone2.goto(link2.replace('http://127.0.0.1:8080/', BASE + '?nosw'));
  await comp2.waitForSelector('.toast >> text=Phone linked!', { timeout: 15000 });
  await comp2.waitForSelector('.pair-sheet', { state: 'detached', timeout: 5000 });
  check(true, 'computer pop-up says “Phone linked!” and closes by itself');
  // Start-menu card opens the same pop-up on a computer
  const comp3 = await mk({ viewport: { width: 1280, height: 820 } }, { relays: ['ws://127.0.0.1:8888'] });
  await comp3.goto(BASE + '?nosw#/');
  await comp3.click('.sync-card');
  await comp3.waitForSelector('.pair-sheet [data-qr] svg', { timeout: 10000 });
  check(true, 'start menu “Show QR code” opens the QR pop-up');

  // Every relay blocked: friendly tip after a while
  const lonely = await mk({ viewport: { width: 390, height: 844 } }, { relays: ['ws://127.0.0.1:8897', 'ws://127.0.0.1:8898'] });
  await lonely.goto(BASE + '?nosw#/link/ABCDEFGHJK');
  await lonely.waitForSelector('[data-slow-tip]', { timeout: 25000 });
  check((await lonely.textContent('[data-slow-tip]')).includes('blocking the relays'), 'no relay reachable: tip suggests switching network or Cloud sync');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll link checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
