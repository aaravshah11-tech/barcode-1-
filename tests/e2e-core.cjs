// Core browser test: start menu, Shelf migration, settings, teams, quick-link pairing.
// Needs the app on :8080 and MQTT test relays on :8888/:8889 (see tests/link-e2e.cjs).
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };
const relays = () => localStorage.setItem('shelf.relays', JSON.stringify(['ws://127.0.0.1:8888', 'ws://127.0.0.1:8889']));

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const watch = (p, n) => p.on('pageerror', (e) => errors.push(`[${n}] ${e.message}`));

  // ---- computer ----
  const cctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await cctx.addInitScript(relays);
  const comp = await cctx.newPage(); watch(comp, 'computer');

  // An old Shelf database on this site should be migrated.
  await comp.goto(BASE + 'manifest.webmanifest');
  await comp.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('shelf', 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('books', { keyPath: 'id' }); db.createObjectStore('rooms', { keyPath: 'id' }); db.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => {
      const tx = r.result.transaction(['books', 'rooms', 'meta'], 'readwrite');
      tx.objectStore('rooms').put({ id: 'r1', name: 'Study', order: 1, cases: [{ id: 'c1', name: 'Tall bookcase', shelves: 4 }], updatedAt: 5, updatedBy: 'x' });
      tx.objectStore('books').put({ id: 'b1', title: 'Old Shelf Book', authors: ['A. Writer'], isbn13: '9780747532699', location: { roomId: 'r1', caseId: 'c1', shelf: '3' }, updatedAt: 6, updatedBy: 'x', addedAt: 1 });
      tx.objectStore('meta').put({ key: 'owners', value: ['Aarav'] });
      tx.oncomplete = () => { r.result.close(); res(); };
    };
  }));

  await comp.goto(BASE + '?nosw#/');
  await comp.waitForSelector('.menu-grid');
  const tiles = await comp.$$eval('.tile-tool .tile-name', (els) => els.map((e) => e.textContent));
  const want = ['Library', 'Inventory', 'Pantry', 'Sports', 'Golf Swing', 'Reminders', 'Settings'];
  check(want.every((t) => tiles.includes(t)) && tiles.at(-1) === 'Settings', 'menu shows the tool tiles: ' + tiles.join(', '));
  if (SHOTS) await comp.screenshot({ path: path.join(SHOTS, 'core-menu-desktop.png') });

  const mig = await comp.evaluate(async () => {
    const s = await import('./js/core/store.js'); const L = await import('./js/core/locations.js');
    const b = s.get('books', 'b1');
    return { title: b?.title, where: L.locationLabel(b?.location), family: s.setting('family') };
  });
  check(mig.title === 'Old Shelf Book' && mig.where === 'Study › Tall bookcase › Shelf 3', `Shelf data migrated: ${mig.title} @ ${mig.where}`);
  check(JSON.stringify(mig.family) === '["Aarav"]', 'Shelf family members migrated');

  // Tool opens with its colour + home button
  await comp.click('.tile-tool >> text=Settings');
  await comp.waitForSelector('text=House locations');
  check(await comp.isVisible('#home-btn'), 'tool shows home button');
  await comp.click('text=House locations');
  await comp.waitForSelector('.room-card');
  check((await comp.textContent('#view')).includes('Study'), 'locations page lists migrated room');

  // Teams: add a team with a squad
  await comp.goto(BASE + '?nosw#/settings/teams');
  await comp.click('[data-new-team]');
  await comp.fill('.sheet input[name=name]', 'Frontage 1st XV');
  await comp.click('.sheet button.btn-primary');
  await comp.waitForSelector('.sheet [data-squad]');
  await comp.fill('.sheet [data-squad]', '9 Sam Jones\n10 Alex Smith\n11 Jo Brown');
  await comp.click('.sheet [data-add-squad]');
  await comp.waitForSelector('.sheet >> text=Jo Brown');
  check(true, 'team + 3 players added');
  await comp.click('.sheet [data-close]');

  // Pairing: quick link
  await comp.goto(BASE + '?nosw#/settings/pair');
  await comp.click('[data-relay-host]');
  await comp.waitForSelector('.code');
  await comp.waitForSelector('[data-qr] svg');
  const code = (await comp.textContent('.code')).replace(/\s/g, '');
  if (SHOTS) await comp.screenshot({ path: path.join(SHOTS, 'core-pair-desktop.png') });

  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await pctx.addInitScript(relays);
  const phone = await pctx.newPage(); watch(phone, 'phone');
  await phone.goto(BASE + `?nosw#/link/${code}`);
  await phone.waitForSelector('text=Linked to your computer', { timeout: 20000 });
  check(true, 'phone paired by opening the QR link');
  await phone.goto(BASE + '?nosw#/');
  await phone.waitForSelector('.menu-grid');
  await phone.waitForFunction(() => document.querySelector('#sync-pill')?.textContent.includes('Linked'), null, { timeout: 15000 });
  const phoneHas = await phone.evaluate(async () => (await import('./js/core/store.js')).all('players').length);
  check(phoneHas === 3, 'phone received the 3 players from the computer');
  if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'core-menu-phone.png') });
  await phone.evaluate(async () => (await import('./js/core/store.js')).put('items', { name: 'Tent' }));
  await comp.waitForSelector('.toast >> text=Tent', { timeout: 10000 });
  check(true, 'item added on phone shows up live on computer');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll core checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
