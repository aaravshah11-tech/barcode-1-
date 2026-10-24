// Live match dashboard (big screen) + finished match report.
import * as store from '../../core/store.js';
import { player } from '../../core/people.js';
import { lineChart, columnChart, pctText } from '../../core/charts.js';
import { esc, icon, fmtClock, formatDate, confirmDialog, toast, debounce } from '../../core/ui.js';
import { SPORT_INFO, match, eventsOf, sideName, sideColor, refLabel, clockMs, periodMs, matchTime, minuteOf } from './common.js';
import { summarize } from './summary.js';
import { eventLabel, suspensions } from './live.js';
import { oversText } from './cricket.js';

const isOurs = (m, ref) => !!ref && !String(ref).startsWith('opp#') && !String(ref).startsWith('name:') && (player(ref)?.teamIds || []).includes(m.teamId);

function compareRows(m, rows) {
  return `<div class="compare">${rows.map(([label, a, b, ta, tb]) => {
    const tot = (Number(a) || 0) + (Number(b) || 0) || 1;
    return `<div class="cmp-row"><span class="cmp-v">${esc(ta ?? a)}</span><span class="cmp-l">${esc(label)}</span><span class="cmp-v">${esc(tb ?? b)}</span>
      <div class="cmp-bar"><i style="width:${((Number(a) || 0) / tot) * 100}%;background:${esc(sideColor(m, 'us'))}"></i><i style="width:${((Number(b) || 0) / tot) * 100}%;background:${esc(sideColor(m, 'them'))}"></i></div></div>`;
  }).join('')}</div>`;
}

function teamRows(m, s) {
  const u = s.sides.us, t = s.sides.them;
  if (m.sport === 'rugby') {
    return [
      ['Points', u.points, t.points], ['Tries', u.tries, t.tries],
      ['Kicks at goal', u.convMade + u.penMade + u.drops, t.convMade + t.penMade + t.drops, `${u.convMade + u.penMade + u.drops}/${u.convMade + u.penMade + u.drops + u.convMiss + u.penMiss} (${pctText(u.convMade + u.penMade + u.drops, u.convMade + u.penMade + u.drops + u.convMiss + u.penMiss)})`, `${t.convMade + t.penMade + t.drops}/${t.convMade + t.penMade + t.drops + t.convMiss + t.penMiss}`],
      ['Tackles', u.tackles, t.tackles, `${u.tackles} (${pctText(u.tackles, u.tackles + u.tacklesMissed)})`, `${t.tackles} (${pctText(t.tackles, t.tackles + t.tacklesMissed)})`],
      ['Carries', u.carries, t.carries], ['Line breaks', u.lineBreaks, t.lineBreaks], ['Turnovers won', u.turnovers, t.turnovers],
      ['Lineouts won', u.lineoutWon, t.lineoutWon, `${u.lineoutWon}/${u.lineoutWon + u.lineoutLost} (${pctText(u.lineoutWon, u.lineoutWon + u.lineoutLost)})`, `${t.lineoutWon}/${t.lineoutWon + t.lineoutLost}`],
      ['Scrums won', u.scrumWon, t.scrumWon, `${u.scrumWon}/${u.scrumWon + u.scrumLost} (${pctText(u.scrumWon, u.scrumWon + u.scrumLost)})`, `${t.scrumWon}/${t.scrumWon + t.scrumLost}`],
      ['Knock-ons', u.knockOns, t.knockOns], ['Penalties conceded', u.pensConceded, t.pensConceded], ['Free kicks conceded', u.freeKicks, t.freeKicks],
      ['Cards (Y/R)', u.yellows + u.reds, t.yellows + t.reds, `${u.yellows}/${u.reds}`, `${t.yellows}/${t.reds}`],
    ];
  }
  return [
    ['Goals', u.goals, t.goals], ['Shots (on target)', u.shotsTotal, t.shotsTotal, `${u.shotsTotal} (${u.shotsOnTotal})`, `${t.shotsTotal} (${t.shotsOnTotal})`],
    ['Short corners', u.pcWon, t.pcWon, `${u.pcGoals}/${u.pcWon} (${u.pcConversion ?? '–'}${u.pcConversion != null ? '%' : ''})`, `${t.pcGoals}/${t.pcWon}`],
    ['Tackles', u.tackles, t.tackles], ['Interceptions', u.interceptions, t.interceptions], ['Turnovers', u.turnovers, t.turnovers],
    ['Cards (G/Y/R)', u.greens + u.yellows + u.reds, t.greens + t.yellows + t.reds, `${u.greens}/${u.yellows}/${u.reds}`, `${t.greens}/${t.yellows}/${t.reds}`],
  ];
}

function playerTable(m, s) {
  const refs = Object.keys(s.players).filter((r) => isOurs(m, r));
  if (!refs.length) return '<p class="muted small">No player events yet.</p>';
  const rows = refs.map((r) => [r, s.players[r]]);
  if (m.sport === 'rugby') {
    rows.sort((a, b) => b[1].points - a[1].points || b[1].tackles - a[1].tackles);
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th class="num">Pts</th><th class="num">Tries</th><th class="num">Kicks</th><th class="num">Tackles</th><th class="num">Tkl %</th><th class="num">Carries</th><th class="num">LB</th><th class="num">TO</th><th class="num">Pens</th><th class="num">Cards</th></tr></thead><tbody>
      ${rows.map(([r, p]) => `<tr><td>${esc(refLabel(m, r))}</td><td class="num"><b>${p.points}</b></td><td class="num">${p.tries}</td><td class="num">${p.kicksMade + p.kicksMissed ? `${p.kicksMade}/${p.kicksMade + p.kicksMissed}` : ''}</td><td class="num">${p.tackles}</td><td class="num">${p.tackleSuccess ?? ''}${p.tackleSuccess != null ? '%' : ''}</td><td class="num">${p.carries}</td><td class="num">${p.lineBreaks}</td><td class="num">${p.turnovers}</td><td class="num">${p.pensConceded}</td><td class="num">${p.yellows ? '🟨'.repeat(p.yellows) : ''}${p.reds ? '🟥' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  rows.sort((a, b) => b[1].goals - a[1].goals || b[1].shots - a[1].shots);
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th class="num">Goals</th><th class="num">PC goals</th><th class="num">Shots</th><th class="num">On target</th><th class="num">Tackles</th><th class="num">Int.</th><th class="num">Cards</th></tr></thead><tbody>
    ${rows.map(([r, p]) => `<tr><td>${esc(refLabel(m, r))}</td><td class="num"><b>${p.goals}</b></td><td class="num">${p.pcGoals}</td><td class="num">${p.shots}</td><td class="num">${p.shotsOn}</td><td class="num">${p.tackles}</td><td class="num">${p.interceptions}</td><td class="num">${'🟩'.repeat(p.greens)}${'🟨'.repeat(p.yellows)}${p.reds ? '🟥' : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function scoreChart(m, events) {
  const def = (e) => (m.sport === 'rugby' ? { try: 5, conv: 2, pen_goal: 3, drop_goal: 3 } : { goal: 1, pc_goal: 1 })[e.type] || 0;
  const us = [[0, 0]], them = [[0, 0]];
  let a = 0, b = 0;
  for (const e of events) {
    const p = def(e);
    if (!p) continue;
    const x = matchTime(m, e.period, e.clockMs) / 60000;
    if (e.side === 'them') { them.push([x, b]); b += p; them.push([x, b]); } else { us.push([x, a]); a += p; us.push([x, a]); }
  }
  const end = Math.max(us.at(-1)[0], them.at(-1)[0], matchTime(m, m.clock?.period || 1, clockMs(m)) / 60000);
  us.push([end, a]); them.push([end, b]);
  return lineChart([{ name: sideName(m, 'us'), points: us, color: sideColor(m, 'us') }, { name: sideName(m, 'them'), points: them, color: sideColor(m, 'them') }], { height: 200, xFmt: (x) => `${Math.round(x)}′`, yLabel: m.sport === 'rugby' ? 'Points' : 'Goals' });
}

function header(m, extra = '') {
  return `<div class="page-head no-print"><a class="icon-btn" href="#/sports/sport/${esc(m.sport)}" aria-label="Back">${icon('back')}</a>
    <div style="flex:1;min-width:200px"><h1 style="margin:0">${esc(SPORT_INFO[m.sport].emoji)} ${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))}</h1>
      <div class="muted small">${esc(formatDate(m.date))}${m.venue ? ` · ${esc(m.venue)}` : ''} · ${m.home === false ? 'Away' : 'Home'}</div></div>
    ${m.status !== 'done' ? `<a class="btn btn-primary" href="#/sports/live/${esc(m.id)}">${icon('qr')} Logging pad</a>` : ''}
    ${extra}
    <a class="btn" href="#/photo/match/${esc(m.id)}">📸 Photos</a>
    <a class="icon-btn" href="#/sports/edit/${esc(m.id)}" aria-label="Edit match">${icon('edit')}</a>
    <button class="icon-btn" data-status-toggle aria-label="${m.status === 'done' ? 'Reopen' : 'Finish'} match" title="${m.status === 'done' ? 'Reopen match' : 'Mark as finished'}">${icon(m.status === 'done' ? 'refresh' : 'flag')}</button>
    <button class="icon-btn" data-delete aria-label="Delete match">${icon('trash')}</button></div>`;
}

function teamDashboard(root, m) {
  const events = eventsOf(m.id);
  const s = summarize(m, events);
  const periods = m.format?.periods || SPORT_INFO[m.sport].periods;
  root.innerHTML = `${header(m)}
    <div class="big-score">
      <div class="bs-team" style="--sc:${esc(sideColor(m, 'us'))}"><span>${esc(sideName(m, 'us'))}</span><b>${s.score.us}</b></div>
      <div class="bs-mid">${m.status === 'live' ? '<span class="tag tag-danger">● LIVE</span>' : m.status === 'done' ? '<span class="tag">Full time</span>' : '<span class="tag">Not started</span>'}
        <div class="bs-clock" data-clock></div><div class="muted">${esc(SPORT_INFO[m.sport].periodName(m.clock?.period || 1, periods))}</div><div data-bins></div></div>
      <div class="bs-team" style="--sc:${esc(sideColor(m, 'them'))}"><b>${s.score.them}</b><span>${esc(sideName(m, 'them'))}</span></div>
    </div>
    <div class="dash-grid">
      <div class="card"><h2>Timeline</h2><div class="timeline">${events.length ? [...events].reverse().map((e) => `<div class="tl-row" style="--sc:${esc(sideColor(m, e.side))}"><span class="tl-min">${minuteOf(m, e)}′</span><span class="tl-dot"></span>
        <div class="grow"><b>${esc(eventLabel(m, e))}</b> <span class="muted">${esc(e.player ? refLabel(m, e.player) : sideName(m, e.side))}${e.player2 ? ` ↔ ${esc(refLabel(m, e.player2))}` : ''}</span></div>
        <button class="icon-btn tl-del" data-del-ev="${esc(e.id)}" aria-label="Delete event">${icon('close')}</button></div>`).join('') : '<p class="muted">Events logged on the phone appear here live.</p>'}</div></div>
      <div class="card"><h2>Team stats</h2><div class="cmp-head"><span>${esc(sideName(m, 'us'))}</span><span>${esc(sideName(m, 'them'))}</span></div>${compareRows(m, teamRows(m, s))}</div>
      <div class="card span-2"><h2>Score progression</h2>${scoreChart(m, events)}</div>
      <div class="card span-2"><h2>Player stats</h2>${playerTable(m, s)}</div>
    </div>`;
}

// ---------- cricket ----------
function scorecard(m, s, n) {
  const inn = s.innings[n - 1];
  if (!inn.legal && !inn.runs && n === 2 && !s.innings[0].closed) return '';
  const side = s.sideOf(n);
  const L = (r) => refLabel(m, r);
  const notOutHere = (b) => !b.out && (b.ref === inn.striker || b.ref === inn.nonStriker) ? 'not out' : (b.how || 'not out');
  return `<div class="card span-2"><h2>${esc(sideName(m, side))} — ${n === 1 ? '1st' : '2nd'} innings: ${inn.runs}/${inn.wickets} <span class="muted">(${inn.overText} overs, RR ${inn.runRate.toFixed(2)})</span></h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>Batter</th><th></th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead><tbody>
    ${inn.batting.map((b) => `<tr><td><b>${esc(L(b.ref))}</b></td><td class="muted small">${esc(notOutHere(b))}</td><td class="num"><b>${b.runs}</b></td><td class="num">${b.balls}</td><td class="num">${b.fours}</td><td class="num">${b.sixes}</td><td class="num">${b.strikeRate.toFixed(1)}</td></tr>`).join('')}
    <tr><td>Extras</td><td class="muted small">wd ${inn.extras.wd}, nb ${inn.extras.nb}, b ${inn.extras.b}, lb ${inn.extras.lb}</td><td class="num">${inn.extras.total}</td><td colspan="4"></td></tr>
    <tr><td><b>Total</b></td><td class="muted small">${inn.wickets} wkts, ${inn.overText} ov</td><td class="num"><b>${inn.runs}</b></td><td colspan="4"></td></tr></tbody></table></div>
    ${inn.fow.length ? `<p class="small"><b>Fall of wickets:</b> ${inn.fow.map((f) => `${f.runs}-${f.wicket} (${esc(L(f.batter))}, ${f.over} ov)`).join(', ')}</p>` : ''}
    <div class="table-wrap"><table class="table"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th><th class="num">Wd</th><th class="num">Nb</th></tr></thead><tbody>
    ${inn.bowling.map((w) => `<tr><td><b>${esc(L(w.ref))}</b></td><td class="num">${w.overs}</td><td class="num">${w.maidens}</td><td class="num">${w.runs}</td><td class="num"><b>${w.wickets}</b></td><td class="num">${w.economy.toFixed(2)}</td><td class="num">${w.wides}</td><td class="num">${w.noBalls}</td></tr>`).join('')}</tbody></table></div>
    ${inn.partnerships.length ? `<p class="small"><b>Partnerships:</b> ${inn.partnerships.map((p) => `${esc(L(p.a))} & ${esc(L(p.b))} ${p.runs} (${p.balls})`).join(' · ')}</p>` : ''}
  </div>`;
}

function cricketDashboard(root, m) {
  const events = eventsOf(m.id);
  const s = summarize(m, events);
  const [i1, i2] = s.innings;
  const line = (n) => { const inn = s.innings[n - 1]; return `${esc(sideName(m, s.sideOf(n)))} <b>${inn.runs}/${inn.wickets}</b> <span class="muted">(${inn.overText})</span>`; };
  const worm = (inn) => { let t = 0; return [[0, 0], ...inn.overs.map((r, i) => [i + 1, (t += r)])]; };
  root.innerHTML = `${header(m)}
    <div class="big-score cricket-score">
      <div>${line(1)}</div>${i1.closed || i2.legal ? `<div>${line(2)}</div>` : ''}
      <div class="bs-status">${s.result ? `<b>${esc(s.result.winner ? `${sideName(m, s.result.winner)} ${s.result.text}` : s.result.text)}</b>`
        : s.current === 2 ? `${esc(sideName(m, s.sideOf(2)))} need <b>${i2.needed}</b> from ${i2.ballsLeft} balls · RRR ${i2.requiredRate?.toFixed(2) ?? '–'}`
          : `${m.status === 'live' ? '<span class="tag tag-danger">● LIVE</span> ' : ''}Run rate ${i1.runRate.toFixed(2)} · ${m.format?.overs} overs`}</div>
    </div>
    <div class="dash-grid">
      ${scorecard(m, s, 1)}${scorecard(m, s, 2)}
      <div class="card"><h2>Runs per over</h2>${columnChart([...i1.overs.map((r, i) => [String(i + 1), r, sideColor(m, s.sideOf(1))])])}${i2.overs.length ? columnChart(i2.overs.map((r, i) => [String(i + 1), r, sideColor(m, s.sideOf(2))])) : ''}</div>
      <div class="card"><h2>Worm</h2>${lineChart([{ name: sideName(m, s.sideOf(1)), points: worm(i1), color: sideColor(m, s.sideOf(1)) }, ...(i2.overs.length ? [{ name: sideName(m, s.sideOf(2)), points: worm(i2), color: sideColor(m, s.sideOf(2)) }] : [])], { xFmt: (x) => `${Math.round(x)}`, xLabel: 'Overs', yLabel: 'Runs' })}</div>
    </div>`;
}

export function renderMatch(root, [id]) {
  const draw = () => {
    const m = match(id);
    if (!m) { root.innerHTML = '<div class="empty"><h2>Match not found</h2><a class="btn" href="#/sports">Back</a></div>'; return; }
    (m.sport === 'cricket' ? cricketDashboard : teamDashboard)(root, m);
    tick();
  };
  const tick = () => {
    const m = match(id);
    if (!m || m.sport === 'cricket') return;
    const el = root.querySelector('[data-clock]');
    if (!el) return;
    const ms = clockMs(m), over = ms - periodMs(m);
    el.textContent = over > 0 ? `${fmtClock(periodMs(m))} +${fmtClock(over)}` : fmtClock(ms);
    const bins = suspensions(m, eventsOf(id));
    root.querySelector('[data-bins]').innerHTML = bins.map((x) => `<span class="bin card-${esc(x.e.type)}">${esc(refLabel(m, x.e.player) || sideName(m, x.e.side))} ${fmtClock(x.remaining)}</span>`).join(' ');
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const m = match(id);
    if (b.dataset.delEv) { const prev = await store.remove('events', b.dataset.delEv); toast('Event deleted', { actionLabel: 'Undo', onAction: () => store.restore('events', prev) }); }
    else if ('statusToggle' in b.dataset) await store.put('matches', { ...m, status: m.status === 'done' ? 'live' : 'done', clock: { ...(m.clock || {}), running: false, startedAt: null, elapsedMs: clockMs(m) } });
    else if ('delete' in b.dataset) {
      if (!(await confirmDialog({ title: 'Delete this match?', message: 'All its events go too.', confirmLabel: 'Delete', danger: true }))) return;
      for (const ev of eventsOf(id)) await store.remove('events', ev.id);
      await store.remove('matches', id);
      location.hash = `#/sports/sport/${m.sport}`;
    }
  });
  draw();
  const timer = setInterval(tick, 1000);
  const redraw = debounce(draw, 150);
  const off = store.onChange(({ changes }) => {
    if (changes.some((c) => (c.c === 'events' && (c.record.matchId === id || c.prev?.matchId === id)) || (c.c === 'matches' && c.record.id === id))) redraw();
  });
  return () => { clearInterval(timer); off(); };
}
export { oversText };
