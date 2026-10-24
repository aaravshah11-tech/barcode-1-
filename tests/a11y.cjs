// Accessibility audit with axe-core on the main screens, in light and dark mode, phone and computer sizes.
// Fails on "serious" or "critical" problems (contrast, missing labels, keyboard traps…).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

const SCREENS = [
  '#/', '#/library', '#/library/book/b1', '#/library/scan', '#/inventory', '#/inventory/add', '#/sports', '#/sports/match/m1', '#/sports/live/m1',
  '#/sports/season', '#/photo', '#/photo/cull/m1', '#/photo/export/m1', '#/golf', '#/golf/swings', '#/golf/trends', '#/golf/golfers', '#/reminders', '#/pantry', '#/pantry/shopping', '#/pantry/add', '#/warranties', '#/warranties/add', '#/settings', '#/settings/account', '#/settings/updates',
];

(async () => {
  const browser = await chromium.launch();
  for (const [scheme, size] of [['light', { width: 1300, height: 860 }], ['dark', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, permissions: [] });
    const page = await ctx.newPage();
    await page.goto(BASE + '?nosw#/');
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const s = await import('./js/core/store.js');
      if (s.get('books', 'b1')) return;
      await s.put('books', { id: 'b1', title: 'The Hobbit', authors: ['J. R. R. Tolkien'], isbn13: '9780261103344', status: 'read', addedAt: Date.now(), lentTo: 'Sam' });
      await s.put('items', { id: 'i1', name: 'Tent', category: 'Camping' });
      await s.put('matches', { id: 'm1', sport: 'rugby', date: '2026-10-24', teamName: 'Frontage', opponent: 'Riverside', status: 'live', periods: 2, periodMins: 40 });
      await s.put('events', { id: 'e1', matchId: 'm1', sport: 'rugby', type: 'try', side: 'us', t: Date.now(), period: 1, clockMs: 60000 });
    });
    for (const hash of SCREENS) {
      await page.goto(BASE + '?nosw' + hash);
      await page.waitForTimeout(500);
      await page.evaluate(AXE);
      const res = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'], rules: { region: { enabled: false } } })).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}${v.id === 'color-contrast' ? ' — ' + v.nodes[0].any[0]?.message : ''}`));
      check(!res.length, `${scheme} ${size.width}px ${hash}${res.length ? '\n    ' + res.join('\n    ') : ''}`);
    }
    // Keyboard: Tab reaches the main links and focus is visible.
    await page.goto(BASE + '?nosw#/');
    await page.waitForTimeout(300);
    const ring = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      ring.push(await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return { tag: a.tagName, visible: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none' }; }));
    }
    check(ring.every((r) => r.tag !== 'BODY') && ring.every((r) => r.visible), `${scheme}: Tab moves through the start menu with a visible focus ring`);
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll accessibility checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
