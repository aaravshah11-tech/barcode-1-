// 🏆 Sports tool: rugby, cricket, hockey live stats + season stats. Photography lives in tools/photo.
import * as store from '../../core/store.js';
import { esc, icon, plural, formatDate, isPhone } from '../../core/ui.js';
import { teams } from '../../core/people.js';
import { SPORT_INFO, matches, sideName, eventsOf } from './common.js';
import { scoreOf } from './summary.js';
import { renderSetup } from './setup.js';
import { renderLive } from './live.js';
import { renderMatch } from './dashboard.js';
import { renderSeason } from './season.js';
import { exportsList } from './export.js';

function resultBadge(m) {
  if (m.status === 'live') return '<span class="tag tag-danger">● LIVE</span>';
  if (m.status !== 'done') return '<span class="tag">Upcoming</span>';
  const s = scoreOf(m);
  const r = s.us > s.them ? ['W', 'tag-ok'] : s.us < s.them ? ['L', 'tag-danger'] : ['D', 'tag-warn'];
  return `<span class="tag ${r[1]}">${r[0]}</span>`;
}

export function matchRow(m) {
  const s = scoreOf(m);
  const info = SPORT_INFO[m.sport];
  const scoreText = m.sport === 'cricket' ? s.text : `${s.us}–${s.them}`;
  return `<a class="row" href="#/sports/${m.status === 'live' && isPhone() ? 'live' : 'match'}/${esc(m.id)}"><span class="thumb-sq">${info.emoji}</span>
    <div class="grow"><div class="row-title">${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))}</div>
    <div class="row-sub">${esc(formatDate(m.date))}${m.venue ? ` · ${esc(m.venue)}` : ''}</div></div>
    <div class="center">${m.status === 'upcoming' ? '' : `<b class="mono">${esc(scoreText)}</b><br>`}${resultBadge(m)}</div></a>`;
}

function renderHome(root) {
  const draw = () => {
    const recent = matches().slice(0, 8);
    root.innerHTML = `<h1>Sports</h1>
      <div class="menu-grid sport-grid">
        ${['rugby', 'cricket', 'hockey'].map((s) => `<a class="tile-tool" href="#/sports/sport/${s}" style="--tl:var(--sport-${s});--td:var(--sport-${s})"><span class="tile-emoji">${SPORT_INFO[s].emoji}</span><span class="tile-name">${SPORT_INFO[s].name}</span><span class="tile-desc">${plural(matches(s).length, 'match', 'matches')}</span></a>`).join('')}
        <a class="tile-tool" href="#/photo" style="--tl:#a8324a;--td:#ef7f95"><span class="tile-emoji">📸</span><span class="tile-name">Match Photography</span><span class="tile-desc">Touchline assistant & photo sorting</span></a>
      </div>
      <div class="section"><div class="section-title">Recent matches</div>
        ${recent.length ? `<div class="rows">${recent.map(matchRow).join('')}</div>` : '<div class="card muted">No matches yet. Pick a sport to start one.</div>'}</div>
      <p class="small muted">Teams and players are shared by all sports — manage them in <a href="#/settings/teams">Settings › Teams & players</a>.</p>`;
  };
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'matches' || c.c === 'events')) draw(); });
}

function renderSport(root, [sport = 'rugby']) {
  const info = SPORT_INFO[sport];
  if (!info) { root.innerHTML = '<p>Unknown sport.</p>'; return; }
  const draw = () => {
    const list = matches(sport);
    const live = list.filter((m) => m.status === 'live');
    const upcoming = list.filter((m) => m.status === 'upcoming');
    const done = list.filter((m) => m.status === 'done');
    root.innerHTML = `<div class="page-head"><h1>${info.emoji} ${info.name}</h1>
        <a class="btn" href="#/sports/season/${sport}">${icon('chart')} Season stats</a><a class="btn btn-primary btn-lg" href="#/sports/new/${sport}">${icon('plus')} New match</a></div>
      ${teams(sport).filter((t) => t.mine).length ? '' : `<div class="banner">${icon('users')}<div class="grow">Add your ${esc(info.name.toLowerCase())} team and players first so you can tap names while logging.</div><a class="btn btn-sm" href="#/settings/teams">Teams</a></div>`}
      ${live.length ? `<div class="section-title">Live now</div><div class="rows">${live.map(matchRow).join('')}</div>` : ''}
      ${upcoming.length ? `<div class="section"><div class="section-title">Upcoming</div><div class="rows">${upcoming.map(matchRow).join('')}</div></div>` : ''}
      <div class="section"><div class="section-title">Results</div>${done.length ? `<div class="rows">${done.map(matchRow).join('')}</div>` : '<div class="card muted">No finished matches yet.</div>'}</div>`;
  };
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'matches' || c.c === 'events')) draw(); });
}

export default {
  routes: { '': renderHome, sport: renderSport, new: renderSetup, edit: (root, [id]) => renderSetup(root, [store.get('matches', id)?.sport, id]), live: renderLive, match: renderMatch, season: renderSeason },
  nav: [
    { route: '', label: 'Sports', icon: 'trophy' },
    { route: 'sport/rugby', label: 'Rugby', emoji: '🏉', match: ['sport/rugby', 'season/rugby', 'new/rugby'] },
    { route: 'sport/cricket', label: 'Cricket', emoji: '🏏', match: ['sport/cricket', 'season/cricket', 'new/cricket'] },
    { route: 'sport/hockey', label: 'Hockey', emoji: '🏑', match: ['sport/hockey', 'season/hockey', 'new/hockey'] },
    { route: 'photo', label: 'Photos', emoji: '📸', href: '#/photo' },
  ],
  exports: exportsList,
};
// eventsOf is re-exported for other tools (photography uses rugby events as moments).
export { eventsOf };
