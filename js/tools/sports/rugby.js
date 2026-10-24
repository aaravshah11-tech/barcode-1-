// 🏉 Rugby: event definitions + stats engine (pure functions, unit tested).

export const RUGBY_EVENTS = [
  { type: 'try', label: 'Try', pts: 5, group: 'Score', player: true, big: true },
  { type: 'conv', label: 'Conversion ✓', pts: 2, group: 'Score', player: true, kick: 'made' },
  { type: 'conv_miss', label: 'Conversion ✗', group: 'Score', player: true, kick: 'missed' },
  { type: 'pen_goal', label: 'Penalty goal ✓', pts: 3, group: 'Score', player: true, kick: 'made' },
  { type: 'pen_miss', label: 'Penalty goal ✗', group: 'Score', player: true, kick: 'missed' },
  { type: 'drop_goal', label: 'Drop goal', pts: 3, group: 'Score', player: true, kick: 'made' },
  { type: 'tackle', label: 'Tackle ✓', group: 'Defence', player: true },
  { type: 'tackle_miss', label: 'Missed tackle', group: 'Defence', player: true },
  { type: 'turnover', label: 'Turnover won', group: 'Defence', player: true },
  { type: 'carry', label: 'Carry', group: 'Attack', player: true },
  { type: 'line_break', label: 'Line break', group: 'Attack', player: true },
  { type: 'knock_on', label: 'Knock-on', group: 'Attack', player: true },
  { type: 'lineout_won', label: 'Lineout won', group: 'Set piece' },
  { type: 'lineout_lost', label: 'Lineout lost', group: 'Set piece' },
  { type: 'scrum_won', label: 'Scrum won', group: 'Set piece' },
  { type: 'scrum_lost', label: 'Scrum lost', group: 'Set piece' },
  { type: 'pen_conceded', label: 'Penalty conceded', group: 'Discipline', player: true },
  { type: 'free_kick', label: 'Free kick conceded', group: 'Discipline', player: true },
  { type: 'yellow', label: 'Yellow card', group: 'Discipline', player: true, card: 'yellow', binMins: 10 },
  { type: 'red', label: 'Red card', group: 'Discipline', player: true, card: 'red' },
  { type: 'sub', label: 'Substitution', group: 'Other', sub: true },
];
export const RUGBY_GROUPS = ['Score', 'Attack', 'Defence', 'Set piece', 'Discipline', 'Other'];
const DEF = Object.fromEntries(RUGBY_EVENTS.map((e) => [e.type, e]));
export const rugbyDef = (type) => DEF[type];

const blankSide = () => ({ points: 0, tries: 0, convMade: 0, convMiss: 0, penMade: 0, penMiss: 0, drops: 0, tackles: 0, tacklesMissed: 0, carries: 0, lineBreaks: 0, turnovers: 0, knockOns: 0, lineoutWon: 0, lineoutLost: 0, scrumWon: 0, scrumLost: 0, pensConceded: 0, freeKicks: 0, yellows: 0, reds: 0 });
const blankPlayer = () => ({ points: 0, tries: 0, kicksMade: 0, kicksMissed: 0, tackles: 0, tacklesMissed: 0, carries: 0, lineBreaks: 0, turnovers: 0, knockOns: 0, pensConceded: 0, yellows: 0, reds: 0 });

const pct = (a, b) => (a + b ? Math.round((a / (a + b)) * 100) : null);

/** Everything about a rugby match from its event log. */
export function summarizeRugby(events) {
  const sides = { us: blankSide(), them: blankSide() };
  const players = {}; // ref -> stats (our and their players)
  const P = (ref) => (players[ref] ||= blankPlayer());
  for (const e of events) {
    const s = sides[e.side] || sides.us;
    const d = DEF[e.type];
    if (!d) continue;
    if (d.pts) s.points += d.pts;
    const p = e.player ? P(e.player) : null;
    if (p && d.pts) p.points += d.pts;
    switch (e.type) {
      case 'try': s.tries++; if (p) p.tries++; break;
      case 'conv': s.convMade++; if (p) p.kicksMade++; break;
      case 'conv_miss': s.convMiss++; if (p) p.kicksMissed++; break;
      case 'pen_goal': s.penMade++; if (p) p.kicksMade++; break;
      case 'pen_miss': s.penMiss++; if (p) p.kicksMissed++; break;
      case 'drop_goal': s.drops++; if (p) p.kicksMade++; break;
      case 'tackle': s.tackles++; if (p) p.tackles++; break;
      case 'tackle_miss': s.tacklesMissed++; if (p) p.tacklesMissed++; break;
      case 'carry': s.carries++; if (p) p.carries++; break;
      case 'line_break': s.lineBreaks++; if (p) p.lineBreaks++; break;
      case 'turnover': s.turnovers++; if (p) p.turnovers++; break;
      case 'knock_on': s.knockOns++; if (p) p.knockOns++; break;
      case 'lineout_won': s.lineoutWon++; break;
      case 'lineout_lost': s.lineoutLost++; break;
      case 'scrum_won': s.scrumWon++; break;
      case 'scrum_lost': s.scrumLost++; break;
      case 'pen_conceded': s.pensConceded++; if (p) p.pensConceded++; break;
      case 'free_kick': s.freeKicks++; break;
      case 'yellow': s.yellows++; if (p) p.yellows++; break;
      case 'red': s.reds++; if (p) p.reds++; break;
      default: break;
    }
  }
  for (const s of Object.values(sides)) {
    s.kicking = pct(s.convMade + s.penMade + s.drops, s.convMiss + s.penMiss);
    s.tackleSuccess = pct(s.tackles, s.tacklesMissed);
    s.lineoutSuccess = pct(s.lineoutWon, s.lineoutLost);
    s.scrumSuccess = pct(s.scrumWon, s.scrumLost);
  }
  for (const p of Object.values(players)) {
    p.kicking = pct(p.kicksMade, p.kicksMissed);
    p.tackleSuccess = pct(p.tackles, p.tacklesMissed);
  }
  return { score: { us: sides.us.points, them: sides.them.points }, sides, players };
}
