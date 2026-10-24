// 📸 Match Photography (opened from Sports).
import { renderHome, renderHub, renderClock, renderTag, renderChecklist, renderPositions, renderSettingsCard } from './touchline.js';
import { renderImport } from './import.js';
import { renderCull } from './cull.js';
import { renderExport } from './export.js';
import { renderStats } from './stats.js';
import * as store from '../../core/store.js';
import { downloadCsv } from '../../core/csv.js';
import { match } from '../sports/common.js';
import { momentLabel } from './match.js';

export default {
  routes: {
    '': renderHome, match: renderHub, clock: renderClock, tag: renderTag, checklist: renderChecklist,
    positions: renderPositions, settings: renderSettingsCard, import: renderImport, cull: renderCull, export: renderExport, stats: renderStats,
  },
  nav: [
    { route: '', label: 'Shoots', icon: 'image', match: ['', 'match', 'checklist', 'positions', 'settings', 'tag'] },
    { route: 'clock', label: 'Clock sync', icon: 'clock' },
    { route: 'stats', label: 'Photo stats', icon: 'chart' },
  ],
  exports: [
    { label: 'Photo ratings & moments (CSV)', run: () => downloadCsv('photos', [
      ['Match', (p) => match(p.matchId)?.title || ''], ['File', (p) => p.path], ['Moment', (p) => (p.momentType ? momentLabel(p.momentType) : '')], ['Number', (p) => p.number],
      ['Stars', (p) => p.rating || ''], ['Flag', (p) => p.flag || ''], ['Camera time', (p) => (p.cameraMs ? new Date(p.cameraMs).toISOString() : '')]], store.all('photos')) },
    { label: 'Photo moment tags (CSV)', run: () => downloadCsv('photo-tags', [
      ['Match', (t) => match(t.matchId)?.title || ''], ['Moment', (t) => momentLabel(t.type)], ['Number', (t) => t.number], ['Time', (t) => new Date(t.t).toISOString()]], store.all('photoTags')) },
  ],
};
