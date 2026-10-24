// Who's on the field and minutes played (pure, unit tested).
//
// starters: player refs who started. Events (in time order) that change the lineup:
//   { type: 'sub', side, player: <off>, player2: <on> }   { type: 'red', side, player }
// mt(e) gives an event's match time (ms since kick-off); endMt is "now" or full time.

export function lineupState(starters = [], events = [], mt, endMt, { side = 'us' } = {}) {
  const on = new Map(); // ref -> came on at (match ms)
  const minutes = {};
  const add = (r, ms) => { minutes[r] = (minutes[r] || 0) + Math.max(0, ms); };
  const subApps = new Set();
  const sentOff = new Set();
  for (const r of starters) on.set(r, 0);
  for (const e of events) {
    if (e.side !== side) continue;
    const t = mt(e);
    if (e.type === 'sub') {
      if (e.player && on.has(e.player)) { add(e.player, t - on.get(e.player)); on.delete(e.player); }
      if (e.player2 && !on.has(e.player2) && !sentOff.has(e.player2)) {
        on.set(e.player2, t);
        if (!starters.includes(e.player2)) subApps.add(e.player2);
      }
    } else if (e.type === 'red' && e.player && on.has(e.player)) {
      add(e.player, t - on.get(e.player));
      on.delete(e.player);
      sentOff.add(e.player);
    }
  }
  for (const [r, since] of on) add(r, endMt - since);
  return { onField: [...on.keys()], minutes, starters: [...starters], subApps: [...subApps], sentOff: [...sentOff] };
}

/** Whole minutes, rounded down (a player on for 39:59 has played 39'). */
export const wholeMinutes = (ms) => Math.floor((ms || 0) / 60000);

/** Default starters: the lowest shirt numbers up to the team size. */
export function defaultStarters(squad, numberOf, size) {
  return [...squad].sort((a, b) => (Number(numberOf(a)) || 999) - (Number(numberOf(b)) || 999)).slice(0, size);
}
