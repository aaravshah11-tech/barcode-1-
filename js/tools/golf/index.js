// ⛳ Golf Swing tool.
import { renderRecord } from './record.js';
import { renderSwings, renderSwing, renderCompare, renderTrends, renderSession, swings } from './views.js';
import { renderGolfers, renderCalibrate, golferName } from './golfers.js';
import { groupSessions } from './analysis.js';
import { downloadCsv } from '../../core/csv.js';

export default {
  routes: { '': renderRecord, swings: renderSwings, swing: renderSwing, session: renderSession, compare: renderCompare, trends: renderTrends, golfers: renderGolfers, calibrate: renderCalibrate },
  nav: [
    { route: '', label: 'Record', icon: 'play', primary: true },
    { route: 'swings', label: 'Swings', icon: 'list', match: ['swings', 'swing', 'session', 'golfers'] },
    { route: 'compare', label: 'Compare', icon: 'chart' },
    { route: 'trends', label: 'Trends', icon: 'refresh' },
  ],
  exports: [{
    label: 'Golf swings (CSV)',
    run: () => { const sess = new Map(groupSessions(swings()).flatMap((g, i, arr) => g.swings.map((s) => [s.id, arr.length - i]))); return downloadCsv('golf-swings', [
      ['Date', (s) => new Date(s.t).toISOString()], ['Golfer', (s) => golferName(s.golferId)], ['Session #', (s) => sess.get(s.id) || ''], ['Club', (s) => s.club], ['Result', (s) => s.result], ['Phone position', (s) => s.placement],
      ['Tempo', (s) => s.metrics?.tempo?.toFixed(2) ?? ''], ['Backswing (s)', (s) => (s.metrics ? (s.metrics.backswingMs / 1000).toFixed(3) : '')],
      ['Downswing (s)', (s) => (s.metrics ? (s.metrics.downswingMs / 1000).toFixed(3) : '')], ['Peak rotation (deg/s, est.)', (s) => (s.metrics ? Math.round(s.metrics.peakRotation) : '')],
      ['Hand speed (mph, est.)', (s) => (s.metrics ? s.metrics.handSpeedMph.toFixed(1) : '')],
    ], swings()); },
  }],
};
