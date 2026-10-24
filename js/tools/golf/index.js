// ⛳ Golf Swing tool.
import { renderRecord } from './record.js';
import { renderSwings, renderSwing, renderCompare, renderTrends, swings } from './views.js';
import { downloadCsv } from '../../core/csv.js';

export default {
  routes: { '': renderRecord, swings: renderSwings, swing: renderSwing, compare: renderCompare, trends: renderTrends },
  nav: [
    { route: '', label: 'Record', icon: 'play', primary: true },
    { route: 'swings', label: 'Swings', icon: 'list', match: ['swings', 'swing'] },
    { route: 'compare', label: 'Compare', icon: 'chart' },
    { route: 'trends', label: 'Trends', icon: 'refresh' },
  ],
  exports: [{
    label: 'Golf swings (CSV)',
    run: () => downloadCsv('golf-swings', [
      ['Date', (s) => new Date(s.t).toISOString()], ['Club', (s) => s.club], ['Result', (s) => s.result], ['Phone position', (s) => s.placement],
      ['Tempo', (s) => s.metrics?.tempo?.toFixed(2) ?? ''], ['Backswing (s)', (s) => (s.metrics ? (s.metrics.backswingMs / 1000).toFixed(3) : '')],
      ['Downswing (s)', (s) => (s.metrics ? (s.metrics.downswingMs / 1000).toFixed(3) : '')], ['Peak rotation (deg/s, est.)', (s) => (s.metrics ? Math.round(s.metrics.peakRotation) : '')],
      ['Hand speed (mph, est.)', (s) => (s.metrics ? s.metrics.handSpeedMph.toFixed(1) : '')],
    ], swings()),
  }],
};
