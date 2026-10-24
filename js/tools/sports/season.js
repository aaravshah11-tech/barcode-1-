// Season stats: results, form, leaderboards and charts per sport.
import * as store from '../../core/store.js';
import { teams, player } from '../../core/people.js';
import { lineChart, bars, pctText } from '../../core/charts.js';
import { esc, formatDate } from '../../core/ui.js';
import { SPORT_INFO, matches, eventsOf, sideName, refLabel, resultOf, lineupOf } from './common.js';
import { wholeMinutes } from './lineup.js';
import { summarize, scoreOf } from './summary.js';
import { aggregate } from './cricket.js';
import { matchRow } from './index.js';

const PREFS = 'sports.seasonPrefs';

export function renderSeason(root, [sport = 'rugby']) {
  const info = SPORT_INFO[sport];
  const prefs = { ...store.getLocal(PREFS, {}) };
  const draw = () => {
    const mine = teams(sport).filter((t) => t.mine);
    const teamId = mine.some((t) => t.id === prefs[sport + 'Team']) ? prefs[sport + 'Team'] : mine[0]?.id || '';
    const years = [...new Set(matches(sport).map((m) => (m.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const year = prefs[sport + 'Year'] && (prefs[sport + 'Year'] === 'all' || years.includes(prefs[sport + 'Year'])) ? prefs[sport + 'Year'] : years[0] || 'all';
    const list = matches(sport).filter((m) => (!teamId || m.teamId === teamId) && (year === 'all' || (m.date || '').startsWith(year)) && m.status !== 'upcoming').reverse(); // oldest first
    const sums = list.map((m) => ({ m, s: summarize(m) }));
    const results = sums.map(({ m, s }) => ({ m, sc: scoreOf(m, s), r: m.status === 'done' ? resultOf(scoreOf(m, s).us, scoreOf(m, s).them) : null }));
    const done = results.filter((x) => x.r);
    const rec = { W: 0, D: 0, L: 0 };
    done.forEach((x) => rec[x.r]++);
    const pf = done.reduce((t, x) => t + x.sc.us, 0), pa = done.reduce((t, x) => t + x.sc.them, 0);

    root.innerHTML = `<div class="page-head"><h1>${info.emoji} ${info.name} season</h1>
        <select data-team aria-label="Team">${mine.map((t) => `<option value="${esc(t.id)}" ${t.id === teamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('') || '<option>No team yet</option>'}</select>
        <select data-year aria-label="Season">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}<option value="all" ${year === 'all' ? 'selected' : ''}>All time</option></select></div>
      ${!list.length ? '<div class="card muted">No matches for this team and season yet.</div>' : `
      <div class="stat-grid">
        <div class="stat"><b>${done.length}</b><span>Played</span></div>
        <div class="stat"><b>${rec.W}-${rec.D}-${rec.L}</b><span>Won-Drawn-Lost</span></div>
        <div class="stat"><b>${pf}<small class="muted">/${pa}</small></b><span>${sport === 'cricket' ? 'Runs for / against' : sport === 'rugby' ? 'Points for / against' : 'Goals for / against'}</span></div>
        <div class="stat"><b class="form">${done.slice(-5).map((x) => `<span class="form-${x.r}">${x.r}</span>`).join('') || '–'}</b><span>Form (last 5)</span></div>
      </div>
      <div class="card section"><h2>${sport === 'cricket' ? 'Runs' : sport === 'rugby' ? 'Points' : 'Goals'} per match</h2>
        ${lineChart([{ name: 'For', points: done.map((x, i) => [i + 1, x.sc.us]), color: 'var(--c3)' }, { name: 'Against', points: done.map((x, i) => [i + 1, x.sc.them]), color: 'var(--c2)', dashed: true }], { xFmt: (x) => `M${Math.round(x)}`, yMin: 0 })}</div>
      ${sport === 'cricket' ? cricketBoards(sums, teamId) : teamBoards(sport, sums, teamId)}
      <div class="section"><div class="section-title">Matches</div><div class="rows">${[...list].reverse().map(matchRow).join('')}</div></div>`}`;
  };
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-team]')) prefs[sport + 'Team'] = e.target.value;
    if (e.target.matches('[data-year]')) prefs[sport + 'Year'] = e.target.value;
    store.setLocal(PREFS, prefs);
    draw();
  });
  draw();
}

const ours = (ref, teamId) => !!ref && (player(ref)?.teamIds || []).includes(teamId);

function teamBoards(sport, sums, teamId) {
  const tot = {};
  for (const { m, s } of sums) {
    const lu = lineupOf(m);
    const played = new Set(Object.keys(s.players).filter((r) => ours(r, teamId)));
    if (lu) [...lu.starters, ...lu.subApps].forEach((r) => played.add(r));
    for (const ref of played) {
      const t = (tot[ref] ||= { apps: 0, starts: 0, minutes: 0 });
      t.apps++;
      if (lu?.starters.includes(ref)) t.starts++;
      if (lu?.minutes[ref]) t.minutes += lu.minutes[ref];
      for (const [k, v] of Object.entries(s.players[ref] || {})) if (typeof v === 'number' && !['kicking', 'tackleSuccess'].includes(k)) t[k] = (t[k] || 0) + v;
    }
  }
  const name = (ref) => player(ref)?.name || '?';
  const top = (key, fmt) => Object.entries(tot).filter(([, t]) => t[key]).sort((a, b) => b[1][key] - a[1][key]).map(([r, t]) => [name(r), t[key], fmt ? fmt(t) : t[key]]);
  if (sport === 'rugby') {
    const kickers = Object.entries(tot).filter(([, t]) => (t.kicksMade || 0) + (t.kicksMissed || 0) >= 3)
      .map(([r, t]) => [name(r), Math.round((t.kicksMade / (t.kicksMade + t.kicksMissed)) * 100), `${pctText(t.kicksMade, t.kicksMade + t.kicksMissed)} (${t.kicksMade}/${t.kicksMade + t.kicksMissed})`]).sort((a, b) => b[1] - a[1]);
    const tacklers = Object.entries(tot).filter(([, t]) => (t.tackles || 0) + (t.tacklesMissed || 0) >= 5)
      .map(([r, t]) => [name(r), Math.round((t.tackles / (t.tackles + t.tacklesMissed)) * 100), `${pctText(t.tackles, t.tackles + t.tacklesMissed)} (${t.tackles}/${t.tackles + t.tacklesMissed})`]).sort((a, b) => b[1] - a[1]);
    return `<div class="three-col section">
      <div class="card"><h2>Top points</h2>${bars(top('points'))}</div>
      <div class="card"><h2>Tries</h2>${bars(top('tries'))}</div>
      <div class="card"><h2>Tackles</h2>${bars(top('tackles'))}</div>
      <div class="card"><h2>Kicking % (3+ kicks)</h2>${bars(kickers, { max: 100 })}</div>
      <div class="card"><h2>Tackle success (5+)</h2>${bars(tacklers, { max: 100 })}</div>
      <div class="card"><h2>Carries</h2>${bars(top('carries'))}</div>
      <div class="card"><h2>Turnovers won</h2>${bars(top('turnovers'))}</div>
      <div class="card"><h2>Line breaks</h2>${bars(top('lineBreaks'))}</div>
      <div class="card"><h2>Discipline (penalties)</h2>${bars(top('pensConceded'), { color: 'var(--danger)' })}</div>
      <div class="card"><h2>Minutes played</h2>${bars(top('minutes', (t) => `${wholeMinutes(t.minutes)}′ · ${t.apps} apps (${t.starts} starts)`), { empty: 'Choose starting line-ups to track minutes.' })}</div></div>`;
  }
  return `<div class="three-col section">
    <div class="card"><h2>Top scorers</h2>${bars(top('goals'))}</div>
    <div class="card"><h2>Short-corner goals</h2>${bars(top('pcGoals'))}</div>
    <div class="card"><h2>Shots</h2>${bars(top('shots', (t) => `${t.shots} (${t.shotsOn} on)`))}</div>
    <div class="card"><h2>Tackles</h2>${bars(top('tackles'))}</div>
    <div class="card"><h2>Interceptions</h2>${bars(top('interceptions'))}</div>
    <div class="card"><h2>Minutes played</h2>${bars(top('minutes', (t) => `${wholeMinutes(t.minutes)}′ · ${t.apps} apps`), { empty: 'Choose starting line-ups to track minutes.' })}</div>
    <div class="card"><h2>Cards</h2>${bars(Object.entries(tot).map(([r, t]) => [name(r), (t.greens || 0) + (t.yellows || 0) + (t.reds || 0), `${t.greens || 0}G ${t.yellows || 0}Y ${t.reds || 0}R`]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]), { color: 'var(--warn)' })}</div></div>`;
}

function cricketBoards(sums, teamId) {
  const ourBat = [], ourBowl = [];
  for (const { m, s } of sums) {
    if (m.teamId !== teamId) continue;
    [1, 2].forEach((n) => { if (s.sideOf(n) === 'us') ourBat.push(s.innings[n - 1]); else ourBowl.push(s.innings[n - 1]); });
  }
  const bat = aggregate(ourBat).batting.filter((b) => ours(b.ref, teamId)).sort((a, b) => b.runs - a.runs);
  const bowl = aggregate(ourBowl).bowling.filter((b) => ours(b.ref, teamId)).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs);
  const n = (x, d = 2) => (x == null ? '–' : x.toFixed(d));
  const name = (r) => player(r)?.name || '?';
  return `<div class="two-col section">
    <div class="card"><h2>Batting</h2><div class="table-wrap"><table class="table"><thead><tr><th>Batter</th><th class="num">Inns</th><th class="num">NO</th><th class="num">Runs</th><th class="num">HS</th><th class="num">Avg</th><th class="num">SR</th><th class="num">4s</th><th class="num">6s</th></tr></thead><tbody>
      ${bat.map((b) => `<tr><td>${esc(name(b.ref))}</td><td class="num">${b.inns}</td><td class="num">${b.notOuts}</td><td class="num"><b>${b.runs}</b></td><td class="num">${b.high}${b.highNotOut ? '*' : ''}</td><td class="num">${n(b.average)}</td><td class="num">${n(b.strikeRate, 1)}</td><td class="num">${b.fours}</td><td class="num">${b.sixes}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No batting yet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Bowling</h2><div class="table-wrap"><table class="table"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Avg</th><th class="num">Econ</th><th class="num">Best</th></tr></thead><tbody>
      ${bowl.map((b) => `<tr><td>${esc(name(b.ref))}</td><td class="num">${b.overs}</td><td class="num">${b.maidens}</td><td class="num">${b.runs}</td><td class="num"><b>${b.wickets}</b></td><td class="num">${n(b.average)}</td><td class="num">${n(b.economy)}</td><td class="num">${b.best ? `${b.best.w}/${b.best.r}` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No bowling yet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Most runs</h2>${bars(bat.map((b) => [name(b.ref), b.runs]))}</div>
    <div class="card"><h2>Most wickets</h2>${bars(bowl.map((b) => [name(b.ref), b.wickets]))}</div></div>`;
}
