// Match Photography data. Only tags, ratings and file references are stored (and synced);
// the photos themselves never leave your computer.
import * as store from '../../core/store.js';
import { numberIn, player } from '../../core/people.js';
import { match, eventsOf, matchTime, clockMs } from '../sports/common.js';
import { eventToMomentType, collectionName } from './match.js';

export const CHECKLIST = [
  { id: 'warmups', label: 'Warm-ups' }, { id: 'team_photo', label: 'Team photo', moment: 'team_photo' },
  { id: 'walkout', label: 'Walk-out / anthem' }, { id: 'kickoff', label: 'Kick-off' },
  { id: 'scrum', label: 'First scrum', moment: 'scrum' }, { id: 'lineout', label: 'Lineout', moment: 'lineout' },
  { id: 'try', label: 'A try', moment: 'try' }, { id: 'kick', label: 'Conversion / kick at goal', moment: 'kick' },
  { id: 'celebration', label: 'Celebration', moment: 'celebration' }, { id: 'coach', label: 'Coach reactions' },
  { id: 'handshakes', label: 'Handshakes', moment: 'handshakes' }, { id: 'crowd', label: 'Crowd / supporters' },
];

export const shoot = (matchId) => ({ checklist: {}, positions: [], offsetMs: 0, windowS: 15, ...(store.get('photoShoots', matchId) || {}), id: matchId });
export const saveShoot = (matchId, patch) => store.put('photoShoots', { ...shoot(matchId), ...patch, id: matchId });
export const tagsOf = (matchId) => store.all('photoTags').filter((t) => t.matchId === matchId).sort((a, b) => a.t - b.t);
export const photosOf = (matchId) => store.all('photos').filter((p) => p.matchId === matchId);
export const photoId = (matchId, path) => `${matchId}:${path}`;

/** Current match time if the match clock has been started, else null. */
export function liveMatchMs(m) {
  if (!m?.clock || (!m.clock.running && !m.clock.elapsedMs)) return null;
  return matchTime(m, m.clock.period || 1, clockMs(m));
}

/** All moments for a match: photo tags + sports events that count as moments. */
export function momentsOf(matchId) {
  const m = match(matchId);
  const tags = tagsOf(matchId).map((t) => ({ id: t.id, t: t.t, type: t.type, number: t.number || '', matchMs: t.matchMs ?? null, source: 'tag' }));
  const evs = m ? eventsOf(matchId).filter((e) => eventToMomentType(e.type)).map((e) => {
    const p = e.player && !String(e.player).startsWith('opp#') ? player(e.player) : null;
    const number = p ? numberIn(p, m.teamId) : String(e.player || '').startsWith('opp#') ? e.player.slice(4) : '';
    return { id: e.id, t: e.t, type: eventToMomentType(e.type), number: number ?? '', matchMs: matchTime(m, e.period, e.clockMs), source: 'stats', side: e.side, playerName: p?.name || '' };
  }) : [];
  return [...tags, ...evs].sort((a, b) => a.t - b.t).map((x) => ({ ...x, name: collectionName(x) }));
}
