// Sports browser test: phone logs matches, computer dashboard updates live (quick-link relays on :8888/:8889).
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };
const relays = () => localStorage.setItem('shelf.relays', JSON.stringify(['ws://127.0.0.1:8888', 'ws://127.0.0.1:8889']));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const cctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  for (const c of [cctx, pctx]) await c.addInitScript(relays);
  const comp = await cctx.newPage(), phone = await pctx.newPage();
  for (const [p, n] of [[comp, 'computer'], [phone, 'phone']]) p.on('pageerror', (e) => errors.push(`[${n}] ${e.message}`));
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, n + '.png') });
  const pick = async (p, num) => { await p.waitForSelector('.sheet .pick'); await p.click(`.sheet .pick:has(b:text-is("${num}"))`); };
  const tap = async (type) => { await phone.click(`[data-ev="${type}"]`); };

  // Pair (quick link)
  await comp.goto(BASE + '?nosw#/settings/pair');
  await comp.click('[data-relay-host]');
  await comp.waitForSelector('.code');
  const code = (await comp.textContent('.code')).replace(/\s/g, '');
  await phone.goto(BASE + `?nosw#/link/${code}`);
  await phone.waitForSelector('text=Linked to your computer', { timeout: 20000 });

  // Teams (created on the phone, synced to computer)
  await phone.evaluate(async () => {
    const s = await import('./js/core/store.js');
    await s.put('teams', { id: 'rug', name: 'Frontage 1st XV', sport: 'rugby', mine: true, colour: '#1d4ed8' });
    await s.put('teams', { id: 'cri', name: 'Frontage CC', sport: 'cricket', mine: true, colour: '#15803d' });
    await s.put('teams', { id: 'hoc', name: 'Frontage HC', sport: 'hockey', mine: true, colour: '#7e22ce' });
    const P = (id, name, team, n) => s.put('players', { id, name, teamIds: [team], numbers: { [team]: n } });
    await P('p9', 'Sam Jones', 'rug', 9); await P('p10', 'Alex Smith', 'rug', 10); await P('p11', 'Jo Brown', 'rug', 11);
    for (const [i, n] of [['c1', 'Ana Patel'], ['c2', 'Ben Cole'], ['c3', 'Cal Reid'], ['c4', 'Dev Shah']].entries()) await P(n[0], n[1], 'cri', i + 1);
    await P('h7', 'Hana Lee', 'hoc', 7); await P('h9', 'Ivy Moss', 'hoc', 9);
  });

  // ---------- Rugby ----------
  await phone.goto(BASE + '?nosw#/sports/new/rugby');
  await phone.waitForSelector('[data-form]');
  await phone.fill('[name=oppName]', 'Riverside RFC');
  await phone.click('[data-preset="2|25"]');
  await phone.click('[data-form] button.btn-primary');
  await phone.waitForSelector('.live .scorebar');
  const matchId = phone.url().split('/').pop();
  check(true, 'rugby match created; logging pad open on phone');
  await phone.click('[data-clock-toggle]');
  await tap('try'); await pick(phone, 11);
  await phone.waitForSelector('.sheet [data-conv="made"]');
  check(true, 'conversion offered straight after the try');
  await phone.click('.sheet [data-conv="made"]'); await pick(phone, 10); // first kick: choose the kicker
  await phone.waitForFunction(() => !document.querySelector('.sheet-backdrop'));
  await phone.click('[data-side="them"]'); await tap('pen_goal'); await pick(phone, 10);
  await tap('tackle'); await pick(phone, 9);
  await tap('tackle'); await pick(phone, 9);
  await tap('tackle_miss'); await pick(phone, 9);
  await tap('lineout_won');
  await tap('yellow'); await pick(phone, 9);
  await phone.waitForSelector('.bin');
  check(/9:5\d|10:00/.test(await phone.textContent('.bin')), 'yellow card starts a 10-minute sin-bin countdown');
  await shot(phone, 'sports-rugby-pad');
  await phone.click('[data-undo]');
  await phone.waitForFunction(() => !document.querySelector('.bin'));
  check(true, 'undo removes the last event (sin bin gone)');
  check((await phone.textContent('[data-score-us]')) === '7' && (await phone.textContent('[data-score-them]')) === '3', 'phone scoreboard 7–3');

  await comp.goto(BASE + `?nosw#/sports/match/${matchId}`);
  await comp.waitForSelector('.big-score');
  await comp.waitForFunction(() => document.querySelector('.big-score')?.textContent.includes('7') && document.querySelector('.timeline')?.textContent.includes('Lineout won'), null, { timeout: 15000 });
  check(true, 'computer dashboard shows the match');
  await tap('try'); await pick(phone, 11);
  await phone.waitForSelector('.sheet [data-kicker]');
  check((await phone.textContent('.sheet [data-kicker]')).includes('#10 Alex Smith'), 'second conversion: last kicker (#10) already chosen');
  await phone.click('.sheet [data-conv="missed"]');
  await comp.waitForFunction(() => document.querySelector('.bs-team b')?.textContent === '12', null, { timeout: 10000 });
  check(true, 'new try on phone updates computer scoreboard live (12)');
  const dash = await comp.textContent('#view');
  check(dash.includes('#11 Jo Brown') && /67%/.test(dash), 'player stats + tackle success % on dashboard');
  await shot(comp, 'sports-rugby-dashboard');
  await phone.click('[data-next]'); await phone.click('.sheet.dialog .btn-primary');
  await phone.waitForSelector('text=2nd half');
  await phone.click('[data-finish]'); await phone.click('.sheet.dialog .btn-primary');
  await phone.waitForSelector('.big-score');
  check(true, 'full time');

  // ---------- Cricket ----------
  await phone.goto(BASE + '?nosw#/sports/new/cricket');
  await phone.waitForSelector('[data-form]');
  await phone.fill('[name=oppName]', 'Village XI');
  await phone.selectOption('[name=fmt]', 'custom');
  await phone.fill('[name=overs]', '1');
  await phone.fill('[name=playersPerSide]', '4');
  await phone.click('[data-form] button.btn-primary');
  await phone.waitForSelector('.cricket .pad-runs');
  const cId = phone.url().split('/').pop();
  await phone.click('[data-runs="1"]');
  await pick(phone, 1); await pick(phone, 2); await pick(phone, 7); // striker, non-striker, opposition bowler #7
  await phone.waitForSelector('.cb-main b:text("1/0")');
  await phone.click('[data-runs="4"]');
  await phone.click('[data-extra="wd"]'); await phone.click('.choice-grid button:has-text("Just the wide")');
  await phone.click('[data-wicket]'); await phone.click('.choice-grid button:has-text("Bowled")');
  await pick(phone, 3); // new batter
  await phone.click('[data-runs="6"]'); await phone.click('[data-runs="0"]'); await phone.click('[data-runs="2"]');
  await phone.waitForSelector('text=Innings over');
  const inn1 = await phone.evaluate(async (id) => { const m = await import('./js/tools/sports/summary.js'); const c = await import('./js/tools/sports/common.js'); const s = m.summarize(c.match(id)); return [s.innings[0].runs, s.innings[0].wickets, s.innings[0].overText]; }, cId);
  check(JSON.stringify(inn1) === '[14,1,"1.0"]', `1st innings 14/1 (1 over): ${inn1}`);
  await shot(phone, 'sports-cricket-pad');
  // Chase: they need 15
  await phone.click('[data-runs="6"]');
  await pick(phone, 1); await pick(phone, 2); await pick(phone, 4); // opp batters #1, #2; our bowler #4 Dev
  await phone.click('[data-runs="4"]'); await phone.click('[data-runs="1"]'); await phone.click('[data-runs="0"]');
  await phone.click('[data-extra="lb"]'); await phone.click('.choice-grid button:has-text("1")');
  await phone.click('[data-runs="0"]');
  await phone.waitForSelector('text=won by 2 runs');
  check(true, 'cricket result: Frontage CC won by 2 runs');
  await comp.goto(BASE + `?nosw#/sports/match/${cId}`);
  await comp.waitForFunction(() => document.querySelector('#view')?.textContent.includes('won by 2 runs'), null, { timeout: 15000 });
  const sc = await comp.textContent('#view');
  check(sc.includes('b #7') && sc.includes('Fall of wickets') && sc.includes('Partnerships'), 'computer scorecard: how out, FoW, partnerships');
  await shot(comp, 'sports-cricket-scorecard');
  await phone.click('[data-finish]');
  await phone.waitForSelector('.big-score');

  // ---------- Hockey ----------
  await phone.goto(BASE + '?nosw#/sports/new/hockey');
  await phone.waitForSelector('[data-form]');
  await phone.fill('[name=oppName]', 'City HC');
  await phone.click('[data-form] button.btn-primary');
  await phone.waitForSelector('.live .scorebar');
  const hId = phone.url().split('/').pop();
  await phone.click('[data-clock-toggle]');
  await tap('goal'); await pick(phone, 9);
  await tap('pc_won'); await tap('pc_goal'); await pick(phone, 7);
  await tap('green'); await pick(phone, 7);
  await phone.waitForSelector('.bin.card-green');
  check(/1:5\d|2:00/.test(await phone.textContent('.bin')), 'green card: 2-minute suspension');
  await comp.goto(BASE + `?nosw#/sports/match/${hId}`);
  await comp.waitForFunction(() => document.querySelector('.bs-team b')?.textContent === '2' && document.querySelector('.compare')?.textContent.includes('1/1 (100%)'), null, { timeout: 15000 });
  check(true, 'hockey dashboard: 2 goals, short corner 1/1 (100%)');
  await comp.click('[data-status-toggle]'); // finish from the computer
  await comp.waitForSelector('.big-score >> text=Full time');

  // ---------- Season ----------
  await comp.goto(BASE + '?nosw#/sports/season/rugby');
  await comp.waitForSelector('.stat-grid');
  const season = await comp.textContent('#view');
  check(season.includes('1-0-0') && season.includes('Jo Brown'), 'rugby season: record + leaderboard');
  await shot(comp, 'sports-rugby-season');
  await comp.goto(BASE + '?nosw#/sports/season/cricket');
  await comp.waitForSelector('.stat-grid');
  check((await comp.textContent('#view')).includes('Ana Patel'), 'cricket season batting table');
  await shot(comp, 'sports-cricket-season');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll sports checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
