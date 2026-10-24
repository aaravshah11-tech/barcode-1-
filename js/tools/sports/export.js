// CSV exports for Sports.
import * as store from '../../core/store.js';
import { downloadCsv } from '../../core/csv.js';
import { matches, match, sideName, refLabel, minuteOf } from './common.js';
import { scoreOf } from './summary.js';
import { eventLabel } from './live.js';

export const exportsList = [
  {
    label: 'Sports matches & results (CSV)',
    run: () => downloadCsv('sports-matches', [
      ['Sport', (m) => m.sport], ['Date', (m) => m.date], ['Team', (m) => sideName(m, 'us')], ['Opponent', (m) => sideName(m, 'them')],
      ['Home/away', (m) => (m.home === false ? 'Away' : 'Home')], ['Venue', (m) => m.venue], ['Status', (m) => m.status],
      ['Score', (m) => scoreOf(m).text], ['For', (m) => scoreOf(m).us], ['Against', (m) => scoreOf(m).them],
    ], matches()),
  },
  {
    label: 'Rugby & hockey events (CSV)',
    run: () => downloadCsv('sports-events', [
      ['Match', (e) => match(e.matchId)?.title || ''], ['Date', (e) => match(e.matchId)?.date || ''], ['Sport', (e) => e.sport],
      ['Minute', (e) => (match(e.matchId) ? minuteOf(match(e.matchId), e) : '')], ['Team', (e) => (match(e.matchId) ? sideName(match(e.matchId), e.side) : e.side)],
      ['Event', (e) => (match(e.matchId) ? eventLabel(match(e.matchId), e) : e.type)], ['Player', (e) => (match(e.matchId) ? refLabel(match(e.matchId), e.player) : '')],
      ['Player 2', (e) => (match(e.matchId) && e.player2 ? refLabel(match(e.matchId), e.player2) : '')], ['Time', (e) => new Date(e.t).toISOString()],
    ], store.all('events').filter((e) => e.sport !== 'cricket' && match(e.matchId)).sort((a, b) => a.t - b.t)),
  },
  {
    label: 'Cricket ball-by-ball (CSV)',
    run: () => downloadCsv('cricket-balls', [
      ['Match', (e) => match(e.matchId)?.title || ''], ['Date', (e) => match(e.matchId)?.date || ''], ['Innings', (e) => e.innings],
      ['Bowler', (e) => refLabel(match(e.matchId), e.bowler)], ['Striker', (e) => refLabel(match(e.matchId), e.striker)], ['Non-striker', (e) => refLabel(match(e.matchId), e.nonStriker)],
      ['Kind', (e) => e.kind], ['Runs', (e) => e.runs], ['Wicket', (e) => e.wicket?.how || ''], ['Out', (e) => (e.wicket ? refLabel(match(e.matchId), e.wicket.out) : '')],
      ['Fielder', (e) => (e.wicket?.fielder ? refLabel(match(e.matchId), e.wicket.fielder) : '')], ['Time', (e) => new Date(e.t).toISOString()],
    ], store.all('events').filter((e) => e.type === 'ball' && match(e.matchId)).sort((a, b) => a.t - b.t)),
  },
];
