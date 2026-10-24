// Two-device test: a "computer" and a "phone" browser linked through MQTT relays.
// Needs: the app served on :8080 and two local MQTT-over-WebSocket brokers on
// 127.0.0.1:8888 and :8889 (e.g. aedes + websocket-stream). A third relay (:8890)
// is deliberately missing to prove a dead relay doesn't break linking.
// Set RELAY_PIDFILE to a file holding the :8888 broker's PID to also test it dying mid-session.
// Usage: node tests/link-e2e.cjs [barcode.y4m] [screenshotDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const [, , Y4M, SHOTS] = process.argv;
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8');
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

async function setup(ctx) {
  await ctx.addInitScript(() => localStorage.setItem('shelf.relays', JSON.stringify(['ws://127.0.0.1:8888', 'ws://127.0.0.1:8889', 'ws://127.0.0.1:8890'])));
  await ctx.route(/openlibrary\.org\/api\/books/, (r) => r.fulfill({ contentType: 'application/json', body: r.request().url().includes('9780747532699') ? fx('ol-9780747532699') : '{}' }));
  await ctx.route(/openlibrary\.org\/(isbn|works)\//, (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.route(/googleapis/, (r) => r.fulfill({ contentType: 'application/json', body: r.request().url().includes('9780141439518') ? fx('google-9780141439518') : '{"totalItems":0}' }));
  await ctx.route(/covers\.openlibrary|books\.google\.com\/books\/content/, (r) => r.fulfill({ status: 404, body: '' }));
}

(async () => {
  const args = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (Y4M) args.push('--use-file-for-fake-video-capture=' + Y4M);
  const browser = await chromium.launch({ args });
  const computerCtx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera'],
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await setup(computerCtx);
  await setup(phoneCtx);
  const computer = await computerCtx.newPage();
  const phone = await phoneCtx.newPage();
  for (const [n, p] of [['computer', computer], ['phone', phone]]) p.on('pageerror', (e) => console.log(`[${n} error]`, e.message));

  // Phone already has a book before linking (should sync across).
  await phone.goto(BASE + '?nosw#/scan');
  await phone.fill('[data-manual] input', '9780747532699');
  await phone.click('[data-manual] button');
  await phone.waitForSelector('.sheet [data-save]');
  await phone.click('.sheet [data-save]');
  await phone.waitForSelector('.toast >> text=Saved');

  // Computer: host
  await computer.goto(BASE + '?nosw#/link');
  await computer.click('[data-host]');
  await computer.waitForSelector('.code');
  await computer.waitForSelector('text=Waiting for your phone', { timeout: 10000 });
  const code = (await computer.textContent('.code')).replace(/\s/g, '');
  check(/^[A-Z0-9]{10}$/.test(code), `computer shows pairing code ${code}`);
  check(!!(await computer.$('[data-qr] svg')), 'computer shows a QR code');
  if (SHOTS) await computer.screenshot({ path: path.join(SHOTS, 'link-computer.png') });

  // Phone: open the pairing link (what scanning the QR with the phone camera does)
  await phone.goto(BASE + `?nosw#/link/${code}`);
  await phone.waitForSelector('text=Connected to Computer', { timeout: 15000 });
  check(true, 'phone connected');
  await computer.waitForSelector('text=Connected to', { timeout: 10000 });
  check(/iPhone/.test(await computer.textContent('[data-status]')), 'computer sees the iPhone');

  // Existing book synced to computer
  await computer.goto(BASE + '?nosw#/');
  await computer.waitForSelector("text=Harry Potter and the Philosopher's Stone", { timeout: 10000 });
  check(true, 'book added on phone before linking appears on computer');

  // Phone scans a new book with the camera -> appears on computer live
  if (Y4M) {
    await phone.goto(BASE + '?nosw#/scan');
    await phone.waitForSelector('.sheet [data-save]', { timeout: 20000 });
    const t = Date.now();
    await phone.click('.sheet [data-save]');
    await computer.waitForSelector('.toast >> text=Pride and Prejudice', { timeout: 10000 });
    check(true, `camera-scanned book appeared on computer in ${Date.now() - t} ms`);
    await computer.waitForSelector('.tile >> text=Pride and Prejudice');
    if (SHOTS) await computer.screenshot({ path: path.join(SHOTS, 'link-computer-live.png') });
  }

  // Computer edit -> phone
  await computer.click(".tile >> text=Harry Potter");
  await computer.waitForSelector('.book-hero');
  await computer.click('[data-status] [data-status=read]');
  await phone.goto(BASE + '?nosw#/');
  await phone.waitForSelector('[data-view]');
  await phone.waitForFunction(() => document.querySelector('#link-pill')?.textContent.includes('Linked'), null, { timeout: 15000 });
  const phoneSees = await phone.evaluate(async () => {
    const s = await import('./js/store.js');
    return s.allBooks().find((b) => b.title.startsWith('Harry'))?.status;
  });
  check(phoneSees === 'read', 'status change on computer reached the phone');

  // One relay dies mid-session -> the other keeps working
  if (process.env.RELAY_PIDFILE) {
    process.kill(+fs.readFileSync(process.env.RELAY_PIDFILE, 'utf8'));
    await computer.waitForTimeout(500);
    await phone.goto(BASE + '?nosw#/scan');
    await phone.fill('[data-manual] input', '9780000000002');
    await phone.click('[data-manual] button');
    await phone.waitForSelector('.book-form input[name=title]');
    await phone.fill('.book-form input[name=title]', 'Relay Survivor');
    await phone.click('.book-form button.btn-primary');
    await computer.goto(BASE + '?nosw#/');
    await computer.waitForSelector('text=Relay Survivor', { timeout: 15000 });
    check(true, 'still syncing after one relay went down');
  }

  // Computer reload -> phone reconnects automatically
  await computer.reload();
  await computer.waitForFunction(() => document.querySelector('#link-pill')?.textContent.startsWith('Linked'), null, { timeout: 40000 });
  check(true, 'after computer reload, phone reconnected automatically');

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll link checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
