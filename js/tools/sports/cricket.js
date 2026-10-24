// 🏏 Cricket scoring engine. Pure functions: replay the ball-by-ball log into
// innings totals, scorecards, partnerships, fall of wickets and run rates.
//
// A "ball" event: {
//   type: 'ball', innings: 1|2, kind: 'normal'|'wd'|'nb'|'b'|'lb', runs: n,
//   striker, nonStriker, bowler,            // player refs at the time
//   wicket?: { how, out: <ref>, fielder? }  // how: bowled|caught|lbw|run out|stumped|hit wicket|retired|other
// }
// runs = runs off the bat (normal, nb) or extra runs ran/scored (wd beyond the 1 penalty, b, lb).
// Other events: { type: 'innings_end', innings }.

export const FORMATS = {
  t20: { label: 'T20', overs: 20 },
  forty: { label: '40 overs', overs: 40 },
  fifty: { label: '50 overs', overs: 50 },
  custom: { label: 'Custom' },
};
export const WICKET_KINDS = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired', 'other'];
const BOWLER_CREDIT = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hit wicket']);

/** Runs added to the total by one ball. */
export function ballTotal(b) {
  if (b.kind === 'wd') return 1 + (b.runs || 0);
  if (b.kind === 'nb') return 1 + (b.runs || 0);
  return b.runs || 0;
}
export const isLegal = (b) => b.kind !== 'wd' && b.kind !== 'nb';
/** Runs the bowler is charged with (byes and leg byes aren't). */
export const bowlerRuns = (b) => (b.kind === 'b' || b.kind === 'lb' ? 0 : ballTotal(b));
/** Runs physically run (decides whether the batters swap ends). */
export const ranRuns = (b) => b.runs || 0;

export const oversText = (legal, perOver = 6) => `${Math.floor(legal / perOver)}.${legal % perOver}`;
export const rate = (runs, legal, perOver = 6) => (legal ? (runs / (legal / perOver)) : 0);

function howOutText(w, label) {
  const b = w.bowler ? label(w.bowler) : '';
  const f = w.fielder ? label(w.fielder) : '';
  switch (w.how) {
    case 'bowled': return `b ${b}`;
    case 'caught': return f && f === b ? `c & b ${b}` : `c ${f || '?'} b ${b}`;
    case 'lbw': return `lbw b ${b}`;
    case 'stumped': return `st ${f || '?'} b ${b}`;
    case 'hit wicket': return `hit wicket b ${b}`;
    case 'run out': return `run out${f ? ` (${f})` : ''}`;
    case 'retired': return 'retired';
    default: return w.how || 'out';
  }
}

/**
 * Replay one innings.
 * opts: { overs, ballsPerOver = 6, wicketsAvailable = 10, target? , label(ref) }
 */
export function replayInnings(balls, opts = {}) {
  const perOver = opts.ballsPerOver || 6;
  const maxWkts = opts.wicketsAvailable ?? 10;
  const label = opts.label || ((r) => r);
  const inn = {
    runs: 0, wickets: 0, legal: 0, extras: { wd: 0, nb: 0, b: 0, lb: 0, total: 0 },
    batting: [], bowling: [], fow: [], partnerships: [], overs: [], // overs: runs per over (for charts)
    striker: null, nonStriker: null, bowler: null, lastBowler: null, closed: false, result: null,
  };
  const bat = new Map(); const bowl = new Map();
  const B = (ref) => { if (!bat.has(ref)) { const x = { ref, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: '' }; bat.set(ref, x); inn.batting.push(x); } return bat.get(ref); };
  const W = (ref) => { if (!bowl.has(ref)) { const x = { ref, legal: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, overRuns: 0 }; bowl.set(ref, x); inn.bowling.push(x); } return bowl.get(ref); };
  let part = null;
  const startPartnership = (a, b) => { part = { a, b, runs: 0, balls: 0, startRuns: inn.runs }; inn.partnerships.push(part); };
  let overRuns = 0;

  for (const ball of balls) {
    if (ball.type === 'innings_end') { inn.closed = true; break; }
    if (ball.type !== 'ball') continue;
    // Batters at the crease for this ball (taken from the ball itself).
    inn.striker = ball.striker; inn.nonStriker = ball.nonStriker; inn.bowler = ball.bowler;
    if (ball.striker) B(ball.striker);
    if (ball.nonStriker) B(ball.nonStriker);
    if (!part || !samePair(part, ball.striker, ball.nonStriker)) startPartnership(ball.striker, ball.nonStriker);

    const total = ballTotal(ball);
    inn.runs += total;
    overRuns += total;
    part.runs += total;
    const s = ball.striker ? B(ball.striker) : null;
    if (ball.kind === 'normal' || ball.kind === 'nb') {
      if (s) { s.runs += ball.runs || 0; if (ball.runs === 4) s.fours++; if (ball.runs === 6) s.sixes++; }
    }
    if (ball.kind !== 'wd' && s) s.balls++; // a no-ball counts as a ball faced
    if (isLegal(ball)) { part.balls++; }
    if (ball.kind === 'wd') { inn.extras.wd += total; }
    if (ball.kind === 'nb') { inn.extras.nb += 1; }
    if (ball.kind === 'b') inn.extras.b += ball.runs || 0;
    if (ball.kind === 'lb') inn.extras.lb += ball.runs || 0;
    if (ball.bowler) {
      const w = W(ball.bowler);
      w.runs += bowlerRuns(ball);
      w.overRuns += bowlerRuns(ball);
      if (ball.kind === 'wd') w.wides++;
      if (ball.kind === 'nb') w.noBalls++;
      if (isLegal(ball)) w.legal++;
    }

    // Strike rotation for runs run.
    let striker = ball.striker, non = ball.nonStriker;
    if (ranRuns(ball) % 2 === 1) [striker, non] = [non, striker];

    if (ball.wicket) {
      const outRef = ball.wicket.out || ball.striker;
      const o = B(outRef);
      o.out = ball.wicket.how !== 'retired';
      o.how = howOutText({ ...ball.wicket, bowler: ball.bowler }, label);
      if (ball.wicket.how !== 'retired') {
        inn.wickets++;
        if (ball.bowler && BOWLER_CREDIT.has(ball.wicket.how)) W(ball.bowler).wickets++;
        inn.fow.push({ wicket: inn.wickets, runs: inn.runs, batter: outRef, over: oversText(inn.legal + (isLegal(ball) ? 1 : 0), perOver) });
      }
      if (striker === outRef) striker = null; else if (non === outRef) non = null;
      part = null;
    }
    if (isLegal(ball)) {
      inn.legal++;
      if (inn.legal % perOver === 0) {
        // End of over: change ends, maiden check, new bowler needed.
        [striker, non] = [non, striker];
        if (ball.bowler) { const w = W(ball.bowler); if (w.overRuns === 0) w.maidens++; }
        inn.overs.push(overRuns);
        overRuns = 0;
        for (const w of inn.bowling) w.overRuns = 0;
        inn.lastBowler = ball.bowler;
        inn.bowler = null;
      }
    }
    inn.striker = striker; inn.nonStriker = non;
    if (inn.wickets >= maxWkts || (opts.overs && inn.legal >= opts.overs * perOver) || (opts.target && inn.runs >= opts.target)) { inn.closed = true; break; }
  }
  if (overRuns || inn.legal % perOver) inn.overs.push(overRuns);
  inn.extras.total = inn.extras.wd + inn.extras.nb + inn.extras.b + inn.extras.lb;
  inn.overText = oversText(inn.legal, perOver);
  inn.runRate = rate(inn.runs, inn.legal, perOver);
  if (opts.target) {
    inn.target = opts.target;
    inn.needed = Math.max(0, opts.target - inn.runs);
    inn.ballsLeft = opts.overs ? opts.overs * perOver - inn.legal : null;
    inn.requiredRate = inn.ballsLeft ? inn.needed / (inn.ballsLeft / perOver) : null;
  }
  for (const b of inn.batting) b.strikeRate = b.balls ? (b.runs / b.balls) * 100 : 0;
  for (const w of inn.bowling) { w.overs = oversText(w.legal, perOver); w.economy = rate(w.runs, w.legal, perOver); delete w.overRuns; }
  return inn;
}
const samePair = (p, a, b) => (p.a === a && p.b === b) || (p.a === b && p.b === a);

/**
 * Whole match. m: { format: { overs, ballsPerOver, playersPerSide }, batFirst: 'us'|'them' }
 * Returns { innings: [inn1, inn2], current: 1|2, result, battingSide(n) }
 */
export function summarizeCricket(m, events, label) {
  const f = m.format || {};
  const opts = { overs: f.overs, ballsPerOver: f.ballsPerOver || 6, wicketsAvailable: (f.playersPerSide || 11) - 1, label };
  const evs = events.filter((e) => e.type === 'ball' || e.type === 'innings_end');
  const inn1 = replayInnings(evs.filter((e) => (e.innings || 1) === 1), opts);
  const inn2Events = evs.filter((e) => e.innings === 2);
  const target = inn1.closed || inn2Events.length ? inn1.runs + 1 : null;
  const inn2 = replayInnings(inn2Events, { ...opts, target: target || undefined });
  const batFirst = m.batFirst || 'us';
  const other = batFirst === 'us' ? 'them' : 'us';
  const sideOf = (n) => (n === 1 ? batFirst : other);
  const current = inn1.closed ? 2 : 1;
  let result = null;
  if (inn1.closed && inn2.closed) {
    const s1 = inn1.runs, s2 = inn2.runs;
    if (s2 > s1) result = { winner: other, text: `won by ${opts.wicketsAvailable - inn2.wickets} wicket${opts.wicketsAvailable - inn2.wickets === 1 ? '' : 's'}` };
    else if (s1 > s2) result = { winner: batFirst, text: `won by ${s1 - s2} run${s1 - s2 === 1 ? '' : 's'}` };
    else result = { winner: null, text: 'Match tied' };
  }
  const total = (side) => (sideOf(1) === side ? inn1 : inn2);
  return { innings: [inn1, inn2], current, result, sideOf, score: { us: total('us').runs, them: total('them').runs }, total };
}

/** Season batting/bowling aggregates across many innings (for one side's player refs). */
export function aggregate(inningsList) {
  const bat = {}, bowl = {};
  for (const inn of inningsList) {
    for (const b of inn.batting) {
      const x = (bat[b.ref] ||= { ref: b.ref, inns: 0, notOuts: 0, runs: 0, balls: 0, fours: 0, sixes: 0, high: 0, highNotOut: false });
      x.inns++; if (!b.out) x.notOuts++;
      x.runs += b.runs; x.balls += b.balls; x.fours += b.fours; x.sixes += b.sixes;
      if (b.runs > x.high || (b.runs === x.high && !b.out)) { x.high = b.runs; x.highNotOut = !b.out; }
    }
    for (const w of inn.bowling) {
      const y = (bowl[w.ref] ||= { ref: w.ref, legal: 0, runs: 0, wickets: 0, maidens: 0, best: null });
      y.legal += w.legal; y.runs += w.runs; y.wickets += w.wickets; y.maidens += w.maidens;
      if (!y.best || w.wickets > y.best.w || (w.wickets === y.best.w && w.runs < y.best.r)) y.best = { w: w.wickets, r: w.runs };
    }
  }
  for (const x of Object.values(bat)) { const outs = x.inns - x.notOuts; x.average = outs ? x.runs / outs : null; x.strikeRate = x.balls ? (x.runs / x.balls) * 100 : 0; }
  for (const y of Object.values(bowl)) { y.overs = oversText(y.legal); y.economy = rate(y.runs, y.legal); y.average = y.wickets ? y.runs / y.wickets : null; y.strikeRate = y.wickets ? y.legal / y.wickets : null; }
  return { batting: Object.values(bat), bowling: Object.values(bowl) };
}
