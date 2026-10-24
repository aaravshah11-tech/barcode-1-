// 🏑 Hockey: event definitions + stats engine (pure functions, unit tested).

export const HOCKEY_EVENTS = [
  { type: 'goal', label: 'Goal', pts: 1, group: 'Score', player: true, big: true },
  { type: 'pc_goal', label: 'Short corner goal', pts: 1, group: 'Score', player: true },
  { type: 'shot_on', label: 'Shot on target', group: 'Attack', player: true },
  { type: 'shot_off', label: 'Shot off target', group: 'Attack', player: true },
  { type: 'pc_won', label: 'Short corner won', group: 'Attack' },
  { type: 'tackle', label: 'Tackle', group: 'Defence', player: true },
  { type: 'interception', label: 'Interception', group: 'Defence', player: true },
  { type: 'turnover', label: 'Turnover', group: 'Defence', player: true },
  { type: 'green', label: 'Green card (2 min)', group: 'Cards', player: true, card: 'green', binMins: 2 },
  { type: 'yellow', label: 'Yellow card (5 min)', group: 'Cards', player: true, card: 'yellow', binMins: 5 },
  { type: 'red', label: 'Red card', group: 'Cards', player: true, card: 'red' },
  { type: 'sub', label: 'Substitution', group: 'Other', sub: true },
];
export const HOCKEY_GROUPS = ['Score', 'Attack', 'Defence', 'Cards', 'Other'];
const DEF = Object.fromEntries(HOCKEY_EVENTS.map((e) => [e.type, e]));
export const hockeyDef = (type) => DEF[type];

const blank = () => ({ goals: 0, pcGoals: 0, pcWon: 0, shotsOn: 0, shotsOff: 0, tackles: 0, interceptions: 0, turnovers: 0, greens: 0, yellows: 0, reds: 0 });

export function summarizeHockey(events) {
  const sides = { us: blank(), them: blank() };
  const players = {};
  const P = (r) => (players[r] ||= { goals: 0, pcGoals: 0, shots: 0, shotsOn: 0, tackles: 0, interceptions: 0, turnovers: 0, greens: 0, yellows: 0, reds: 0 });
  for (const e of events) {
    const s = sides[e.side] || sides.us;
    const p = e.player ? P(e.player) : null;
    switch (e.type) {
      case 'goal': s.goals++; if (p) { p.goals++; p.shots++; p.shotsOn++; } break;
      case 'pc_goal': s.goals++; s.pcGoals++; if (p) { p.goals++; p.pcGoals++; p.shots++; p.shotsOn++; } break;
      case 'shot_on': s.shotsOn++; if (p) { p.shots++; p.shotsOn++; } break;
      case 'shot_off': s.shotsOff++; if (p) p.shots++; break;
      case 'pc_won': s.pcWon++; break;
      case 'tackle': s.tackles++; if (p) p.tackles++; break;
      case 'interception': s.interceptions++; if (p) p.interceptions++; break;
      case 'turnover': s.turnovers++; if (p) p.turnovers++; break;
      case 'green': s.greens++; if (p) p.greens++; break;
      case 'yellow': s.yellows++; if (p) p.yellows++; break;
      case 'red': s.reds++; if (p) p.reds++; break;
      default: break;
    }
  }
  for (const s of Object.values(sides)) {
    // A short-corner goal implies the corner was won, even if "won" wasn't tapped.
    s.pcWon = Math.max(s.pcWon, s.pcGoals);
    s.pcConversion = s.pcWon ? Math.round((s.pcGoals / s.pcWon) * 100) : null;
    s.shotsTotal = s.shotsOn + s.shotsOff + s.goals;
    s.shotsOnTotal = s.shotsOn + s.goals;
  }
  return { score: { us: sides.us.goals, them: sides.them.goals }, sides, players };
}
