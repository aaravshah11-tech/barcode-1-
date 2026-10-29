// Part 8: Intel panel (location → weather + sunrise/sunset), Mission Briefing, Agent diagnostics
// (battery + link charts, low-battery alert), the new Agent screen, and the matching terminal commands.
// The weather service is replaced by a stand-in, so nothing leaves the test machine.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

const GEO = { results: [{ name: 'Guildford', admin1: 'England', country: 'United Kingdom', latitude: 51.23622, longitude: -0.57055 }] };
function forecast() {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const hours = [0, 1, 2, 3].map((k) => { const d = new Date(now.getTime() + k * 3600000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`; });
  return {
    utc_offset_seconds: 0,
    current: { temperature_2m: 11.6, apparent_temperature: 9.2, weather_code: 3, wind_speed_10m: 12.4, precipitation: 0, cloud_cover: 96, is_day: 1 },
    hourly: { time: hours, precipitation_probability: [5, 10, 85, 90], precipitation: [0, 0, 1.4, 2], weather_code: [3, 3, 63, 63] },
    daily: { temperature_2m_max: [13.2], temperature_2m_min: [6.8] },
  };
}

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const asked = [];
  await ctx.route('https://geocoding-api.open-meteo.com/**', (r) => { asked.push(r.request().url()); r.fulfill({ json: GEO }); });
  await ctx.route('https://api.open-meteo.com/**', (r) => { asked.push(r.request().url()); r.fulfill({ json: forecast() }); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);

  // ---- Intel panel: no location yet ----
  await page.waitForSelector('[data-intel] [data-setloc]');
  check(true, 'Situation panel asks for a location for weather and sunrise/sunset');
  await page.click('[data-intel] [data-setloc]');
  await page.fill('[data-locsearch] [name=q]', 'Guildford');
  await page.click('[data-locsearch] button:not([type=button])');
  await page.click('[data-lochit="0"]');
  await page.waitForSelector('[data-locnow] >> text=Guildford');
  check(true, 'Settings: search a town and pick it');
  const s = await page.evaluate(() => window.__hq.hq.settings().location);
  check(s.lat === 51.24 && s.lon === -0.57, `location saved roughly (to ~1 km): ${s.lat}, ${s.lon}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-intel] .wx-temp', { timeout: 10000 });
  check((await page.textContent('[data-intel] .wx-temp')).trim() === '12°', 'weather shows: 12° (rounded)');
  const intelText = await page.textContent('[data-intel]');
  check(intelText.includes('Overcast') && intelText.includes('wind 12 mph'), 'conditions and wind shown');
  check(/Precipitation expected in about/.test(intelText), 'rain warning: precipitation expected soon');
  check(/Sunrise\s*\d\d:\d\d/.test(intelText) && /Sunset\s*\d\d:\d\d/.test(intelText), 'sunrise and sunset shown (worked out on this computer)');
  const fcUrl = asked.find((u) => u.startsWith('https://api.open-meteo.com/'));
  if (!(fcUrl && fcUrl.includes('latitude=51.24'))) console.log('forecast URL:', asked);
  check(fcUrl && fcUrl.includes('latitude=51.24') && fcUrl.includes('longitude=-0.57'), 'only the rough position is sent to the weather service');
  await shot(page, 'intel-weather');

  // ---- Agent + diagnostics ----
  const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await actx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'getBattery', { value: undefined }); }); // the test supplies the battery readings
  const agent = await recruit(page, actx, world);
  agent.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  await agent.p.waitForSelector('.ag-radar', { timeout: 8000 }).catch(async (e) => { console.log('AGENT:', (await agent.p.content()).slice(0, 1500), errors); throw e; });
  await agent.p.waitForFunction(() => /\d+ ms/.test(document.querySelector('[data-linkms]')?.textContent || ''), null, { timeout: 30000 });
  check(true, 'Agent screen: radar, and its link time to HQ in ms');
  check((await agent.p.textContent('[data-mname]')).includes('STANDBY'), 'Agent screen shows its mission');
  check(await agent.p.isVisible('[data-banner]'), 'the SENTINEL AGENT ACTIVE banner is still there');
  check((await agent.p.textContent('.standby')).toUpperCase().includes('AWAITING ORDERS'), 'standby: big radar, “Awaiting orders”');
  await shot(agent.p, 'agent-screen');

  // Pretend the battery is running down (readings arrive as the Agent would send them)
  await page.evaluate((id) => {
    const hq = window.__hq.hq, t0 = Date.now();
    const all = hq.diagAll();
    all[id] = Array.from({ length: 30 }, (_, i) => ({ t: t0 - (30 - i) * 30 * 60000, b: 95 - i * 2, c: i < 4, r: 40 + (i % 5) * 12 }));
    hq.db.setSetting('diag', all);
    hq.agentStatus(id, { battery: 0.18, charging: false, rtt: 52 });
  }, agent.id);
  await page.waitForSelector('[data-log] >> text=battery low (18%)');
  check(true, 'Mission Log warns: battery low (18%) — plug it in');
  await page.evaluate((id) => window.__hq.hq.agentStatus(id, { battery: 0.17, charging: false }), agent.id);
  await page.waitForTimeout(300);
  const lowLogged = await page.evaluate(() => window.__hq.hq.db.events({ limit: 500 }).filter((e) => /battery low/.test(e.message)).length);
  if (lowLogged !== 1) console.log('DEBUG battery events:', await page.evaluate(() => window.__hq.hq.db.events({ limit: 50 }).map((e) => e.message)), 'agent getBattery:', await agent.p.evaluate(() => typeof navigator.getBattery));
  check(lowLogged === 1, 'the warning is only given once');

  await page.click('.agent');
  await page.waitForSelector('[data-diag] .tchart svg');
  const diag = await page.textContent('[data-diag]');
  check(diag.includes('Link to HQ') && /\d+ ms · (Excellent|Good|Fair|Poor)/.test(diag), 'Diagnostics: link time with a plain-words rating');
  check(diag.includes('Connected for') && diag.includes('Agent running for') && diag.includes('Dropouts (24 h)'), 'Diagnostics: uptime and dropouts');
  check(await page.$$eval('[data-diag] .tchart svg', (s) => s.length) === 2, 'battery and link-time charts drawn');
  check(await page.$$eval('[data-diag] .tchart path.line', (p) => p.every((x) => (x.getAttribute('d').match(/L/g) || []).length > 20)), 'the charts draw a continuous line through the readings');
  const chart = await page.locator('[data-diag] .tchart svg').first().boundingBox();
  await page.mouse.move(chart.x + chart.width * 0.5, chart.y + chart.height / 2);
  await page.waitForSelector('[data-diag] .tip:not([hidden])');
  check(/\d\d:\d\d · \d+%/.test(await page.textContent('[data-diag] .tip')), 'hovering the battery chart shows the time and %');
  await shot(page, 'agent-diagnostics');
  await page.keyboard.press('Escape');

  // ---- Mission Briefing ----
  await page.evaluate((id) => {
    const hq = window.__hq.hq, d = new Date(); d.setHours(0, 0, 0, 0);
    const y = (h, m = 0) => d.getTime() - 86400000 + (h * 60 + m) * 60000;
    hq.db.addEvent({ ts: y(8), kind: 'system', message: 'Security mode: AWAY — x', data: { mode: 'away', from: 'home' } });
    hq.db.addEvent({ ts: y(10, 15), kind: 'motion', agentId: id, level: 'alert', message: 'AGENT-01: motion detected' });
    hq.db.addEvent({ ts: y(17, 40), kind: 'system', message: 'Security mode: HOME — x', data: { mode: 'home', from: 'away' } });
    for (let i = 0; i < 4; i++) hq.db.addEvent({ ts: y(18, i * 5), kind: 'motion', agentId: id, level: 'info', message: 'AGENT-01: motion detected' });
  }, agent.id);
  await page.click('[data-briefing]');
  await page.waitForSelector('.briefing .brief-head');
  const brief = await page.textContent('.briefing');
  check(brief.includes('1 alert raised'), 'Briefing headline: 1 alert raised');
  check(/Departed \(AWAY\)/.test(brief) && /Returned \(HOME\)/.test(brief), 'Briefing: comings and goings (AWAY / HOME)');
  check(brief.includes('busiest hour') && brief.includes('18:00'), 'Briefing: first/last activity and busiest hour');
  check(await page.$$eval('.brief-bars li', (l) => l.length) >= 1, 'Briefing: busiest rooms');
  check(brief.includes('Agent health') && brief.includes(agent.codename || ''), 'Briefing: Agent health table');
  await shot(page, 'briefing');
  await page.click('[data-bday="0"]');
  await page.waitForSelector('.briefing [data-bday="0"][aria-pressed="true"]');
  check(true, '“Today so far” switches the period');
  await page.keyboard.press('Escape');

  // Opens by itself next morning (once): pretend it hasn’t been seen today
  await page.evaluate(() => localStorage.removeItem('sentinel.briefingSeen'));
  const hour = new Date().getHours();
  await page.reload();
  const { login } = require('./helpers.cjs');
  await login(page);
  if (hour >= 5) {
    await page.waitForSelector('.briefing', { timeout: 15000 });
    check(true, 'the briefing opens by itself the first time HQ is opened each morning');
    await page.keyboard.press('Escape');
    await page.reload(); await login(page); await page.waitForTimeout(2500);
    check(!(await page.$('.briefing')), '…and only once a day');
  } else check(true, '(before 5 am: automatic briefing not tested)');

  // ---- Terminal ----
  await page.click('.p-log .panel-head h2');
  await page.keyboard.press('Backquote');
  await page.waitForSelector('[data-termin]');
  const run = async (cmd, want) => { await page.fill('[data-termin]', cmd); await page.press('[data-termin]', 'Enter'); await page.waitForFunction((w) => document.querySelector('[data-termout]').textContent.includes(w), want, { timeout: 10000 }); };
  await run('weather', 'degrees and overcast in Guildford');
  check(true, 'terminal: weather');
  await run('briefing', 'Yesterday: 1 alert raised');
  check(true, 'terminal: briefing');
  await run('where is everyone', 'last 30 minutes');
  check(true, 'terminal/voice: “where is everyone?”');
  await page.waitForSelector('[data-agents] >> text=ONLINE', { timeout: 60000 });
  await page.evaluate((id) => window.__hq.hq.agentStatus(id, { battery: 0.15, charging: false }), agent.id);
  await run('diag', 'low on battery');
  check(true, 'terminal: diag shows the low battery');

  await finish(browser, world, errors, 'intel, briefing & diagnostics');
})().catch((e) => { console.error(e); process.exit(1); });
