import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRugby, lastKicker } from '../js/tools/sports/rugby.js';
import { summarizeHockey } from '../js/tools/sports/hockey.js';
import { replayInnings, summarizeCricket, aggregate } from '../js/tools/sports/cricket.js';

const ev = (side, type, player) => ({ side, type, player });

test('rugby: score, kicking %, tackle %, set piece, cards', () => {
  const s = summarizeRugby([
    ev('us', 'try', 'p11'), ev('us', 'conv', 'p10'), ev('them', 'pen_goal', 'opp#10'), ev('us', 'try', 'p14'), ev('us', 'conv_miss', 'p10'),
    ev('us', 'pen_goal', 'p10'), ev('us', 'drop_goal', 'p10'), ev('us', 'tackle', 'p7'), ev('us', 'tackle', 'p7'), ev('us', 'tackle', 'p6'), ev('us', 'tackle_miss', 'p6'),
    ev('us', 'lineout_won'), ev('us', 'lineout_won'), ev('us', 'lineout_lost'), ev('us', 'scrum_won'), ev('us', 'yellow', 'p3'), ev('them', 'try', 'opp#9'),
    ev('us', 'pen_conceded', 'p3'),
  ]);
  assert.deepEqual(s.score, { us: 5 + 2 + 5 + 3 + 3, them: 3 + 5 });
  assert.equal(s.sides.us.tries, 2);
  assert.equal(s.sides.us.kicking, 75); // 3 made of 4
  assert.equal(s.players.p10.points, 8);
  assert.equal(s.players.p10.kicking, 75);
  assert.equal(s.sides.us.tackleSuccess, 75);
  assert.equal(s.players.p7.tackleSuccess, 100);
  assert.equal(s.sides.us.lineoutSuccess, 67);
  assert.equal(s.sides.us.scrumSuccess, 100);
  assert.equal(s.sides.us.yellows, 1);
  assert.equal(s.players.p3.pensConceded, 1);
});

test('hockey: goals, short-corner conversion, shots, cards', () => {
  const s = summarizeHockey([
    ev('us', 'pc_won'), ev('us', 'pc_won'), ev('us', 'pc_goal', 'h9'), ev('us', 'goal', 'h9'), ev('us', 'shot_on', 'h7'), ev('us', 'shot_off', 'h7'),
    ev('them', 'goal', 'opp#4'), ev('us', 'green', 'h2'), ev('them', 'yellow', 'opp#5'),
  ]);
  assert.deepEqual(s.score, { us: 2, them: 1 });
  assert.equal(s.sides.us.pcConversion, 50);
  assert.equal(s.sides.us.shotsTotal, 4);
  assert.equal(s.sides.us.shotsOnTotal, 3);
  assert.equal(s.players.h9.goals, 2);
  assert.equal(s.players.h9.pcGoals, 1);
  assert.equal(s.sides.them.yellows, 1);
});

/** Play balls the way the phone does: use the engine's striker/bowler, bring in new batters/bowlers in order. */
function play(script, { batters, bowlers, innings = 1, opts = {} }) {
  const balls = [];
  let nextBat = 2, nextBowl = 0;
  const parse = (t) => {
    if (t === 'W') return { kind: 'normal', runs: 0, wicket: { how: 'bowled' } };
    const m = t.match(/^(wd|nb|lb|b)?(\d*)$/);
    return { kind: m[1] || 'normal', runs: +(m[2] || 0) };
  };
  for (const t of script) {
    const s = replayInnings(balls, opts);
    const striker = s.striker === undefined || balls.length === 0 ? batters[0] : s.striker ?? batters[nextBat++];
    const non = balls.length === 0 ? batters[1] : s.nonStriker ?? batters[nextBat++];
    const bowler = s.bowler || (balls.length === 0 ? bowlers[nextBowl++] : bowlers[nextBowl++ % bowlers.length]);
    const b = { type: 'ball', innings, striker, nonStriker: non, bowler, ...parse(t) };
    if (b.wicket) b.wicket.out = striker;
    balls.push(b);
  }
  return balls;
}

test('cricket: extras, strike rotation, maidens, wickets, partnerships', () => {
  const balls = play(['1', '4', 'wd', '0', 'nb2', 'lb1', '2', '0', 'W', '0', '0', '0', '0', '0'], { batters: ['A', 'B', 'C', 'D'], bowlers: ['X', 'Y'] });
  const inn = replayInnings(balls, { overs: 20 });
  assert.equal(inn.runs, 12);
  assert.equal(inn.wickets, 1);
  assert.equal(inn.overText, '2.0');
  assert.equal(inn.runRate, 6);
  assert.deepEqual(inn.extras, { wd: 1, nb: 1, b: 0, lb: 1, total: 3 });
  const bat = Object.fromEntries(inn.batting.map((b) => [b.ref, b]));
  assert.deepEqual([bat.A.runs, bat.A.balls, bat.A.out], [3, 3, false]);
  assert.deepEqual([bat.B.runs, bat.B.balls, bat.B.fours, bat.B.out, bat.B.how], [6, 5, 1, true, 'b Y']);
  assert.deepEqual([bat.C.runs, bat.C.balls], [0, 5]);
  const bowl = Object.fromEntries(inn.bowling.map((b) => [b.ref, b]));
  assert.deepEqual([bowl.X.overs, bowl.X.runs, bowl.X.wides, bowl.X.noBalls, bowl.X.maidens], ['1.0', 11, 1, 1, 0]);
  assert.deepEqual([bowl.Y.overs, bowl.Y.runs, bowl.Y.wickets, bowl.Y.maidens], ['1.0', 0, 1, 1]);
  assert.deepEqual(inn.fow, [{ wicket: 1, runs: 12, batter: 'B', over: '1.1' }]);
  assert.deepEqual(inn.partnerships.map((p) => [p.runs, p.balls]), [[12, 7], [0, 5]]);
  assert.equal(inn.striker, 'A'); // C faced the rest of over 2, ends swap
  assert.equal(inn.nonStriker, 'C');
  assert.deepEqual(inn.overs, [12, 0]);
});

test('cricket: chase, target, required rate and result', () => {
  const m = { format: { overs: 20, playersPerSide: 11 }, batFirst: 'us' };
  const first = play(['6', '6'], { batters: ['A', 'B'], bowlers: ['X'] });
  const second = play(['4', '1'], { batters: ['P', 'Q'], bowlers: ['Y'], innings: 2 });
  let s = summarizeCricket(m, [...first, { type: 'innings_end', innings: 1 }, ...second]);
  assert.equal(s.current, 2);
  assert.equal(s.innings[1].target, 13);
  assert.equal(s.innings[1].needed, 8);
  assert.equal(s.innings[1].ballsLeft, 118);
  assert.ok(Math.abs(s.innings[1].requiredRate - 8 / (118 / 6)) < 1e-9);
  assert.equal(s.result, null);
  const chase = play(['4', '1', '6', '2'], { batters: ['P', 'Q'], bowlers: ['Y'], innings: 2 });
  s = summarizeCricket(m, [...first, { type: 'innings_end', innings: 1 }, ...chase]);
  assert.equal(s.innings[1].runs, 13);
  assert.ok(s.innings[1].closed);
  assert.deepEqual(s.result, { winner: 'them', text: 'won by 10 wickets' });
  assert.deepEqual(s.score, { us: 12, them: 13 });
});

test('cricket: all out ends the innings; season averages', () => {
  const m = { format: { overs: 20, playersPerSide: 3 }, batFirst: 'them' };
  const balls = play(['2', 'W', '1', 'W', '4'], { batters: ['A', 'B', 'C'], bowlers: ['X'] });
  const s = summarizeCricket(m, balls);
  assert.equal(s.innings[0].wickets, 2);
  assert.ok(s.innings[0].closed, 'all out with 2 wickets when 3-a-side');
  assert.equal(s.innings[0].runs, 3); // the ball after all out isn't counted
  const agg = aggregate([s.innings[0], s.innings[0]]);
  const A = agg.batting.find((b) => b.ref === 'A');
  assert.equal(A.inns, 2);
  assert.equal(A.average, 2);
  const X = agg.bowling.find((b) => b.ref === 'X');
  assert.equal(X.wickets, 4);
  assert.deepEqual(X.best, { w: 2, r: 3 });
});

test('rugby: last kicker for the conversion prompt', () => {
  const evs = [ev('us', 'pen_goal', 'p15'), ev('them', 'conv', 'opp#10'), ev('us', 'try', 'p11'), ev('us', 'conv', 'p10'), ev('us', 'tackle', 'p7')];
  assert.equal(lastKicker(evs, 'us'), 'p10');
  assert.equal(lastKicker(evs, 'them'), 'opp#10');
  assert.equal(lastKicker([], 'us'), '');
});

test('lineup: on field, substitutions, red cards, minutes played', async () => {
  const { lineupState, wholeMinutes, defaultStarters } = await import('../js/tools/sports/lineup.js');
  const M = 60000;
  const mt = (e) => e.at * M;
  const events = [
    { side: 'us', type: 'try', player: 'a', at: 5 },
    { side: 'us', type: 'sub', player: 'b', player2: 'x', at: 50 },   // b off, x on
    { side: 'them', type: 'sub', player: 'opp#1', player2: 'opp#16', at: 55 },
    { side: 'us', type: 'red', player: 'c', at: 60 },                // c sent off
    { side: 'us', type: 'sub', player: 'x', player2: 'b', at: 70 },   // b back on (rolling subs)
    { side: 'us', type: 'sub', player: 'a', player2: 'c', at: 72 },   // red-carded player can't come back
  ];
  const s = lineupState(['a', 'b', 'c'], events, mt, 80 * M);
  assert.deepEqual(s.onField.sort(), ['b']);
  assert.deepEqual(Object.fromEntries(Object.entries(s.minutes).map(([k, v]) => [k, wholeMinutes(v)])), { a: 72, b: 60, c: 60, x: 20 });
  assert.deepEqual(s.subApps, ['x']);
  assert.deepEqual(s.sentOff, ['c']);
  assert.deepEqual(defaultStarters(['p3', 'p1', 'p2', 'p9'], (r) => ({ p1: 1, p2: 2, p3: 3, p9: 16 })[r], 3), ['p1', 'p2', 'p3']);
});

test('cricket: run out off a no-ball, stumped off a wide', () => {
  const base = { type: 'ball', innings: 1, bowler: 'X' };
  const inn = replayInnings([
    { ...base, striker: 'A', nonStriker: 'B', kind: 'nb', runs: 1, wicket: { how: 'run out', out: 'B', fielder: 'F' } },
    { ...base, striker: 'B2', nonStriker: 'A', kind: 'wd', runs: 0, wicket: { how: 'stumped', out: 'B2', fielder: 'K' } },
  ], { overs: 20 });
  assert.equal(inn.runs, 3);            // nb (1+1) + wide (1)
  assert.equal(inn.wickets, 2);
  assert.equal(inn.legal, 0);           // neither ball counts towards the over
  const bat = Object.fromEntries(inn.batting.map((b) => [b.ref, b]));
  assert.equal(bat.A.balls, 1);         // a no-ball is faced
  assert.equal(bat.A.runs, 1);
  assert.equal(bat.B.how, 'run out (F)');
  assert.equal(bat.B2.balls, 0);        // a wide isn't faced
  assert.equal(bat.B2.how, 'st K b X');
  const X = inn.bowling[0];
  assert.equal(X.wickets, 1);           // stumping credited, run out not
  assert.equal(X.runs, 3);
  assert.deepEqual([X.wides, X.noBalls], [1, 1]);
});

test('cricket: retired hurt can come back, retired out is a wicket', () => {
  const b = (striker, nonStriker, runs, extra = {}) => ({ type: 'ball', innings: 1, bowler: 'X', striker, nonStriker, kind: 'normal', runs, ...extra });
  let inn = replayInnings([
    b('A', 'B', 4), b('A', 'B', 2),
    { type: 'retire', innings: 1, batter: 'A', how: 'retired hurt' },
  ], { overs: 20 });
  assert.equal(inn.wickets, 0);
  assert.equal(inn.striker, null);
  assert.equal(inn.batting.find((x) => x.ref === 'A').how, 'retired hurt');
  inn = replayInnings([
    b('A', 'B', 4), b('A', 'B', 2),
    { type: 'retire', innings: 1, batter: 'A', how: 'retired hurt' },
    b('C', 'B', 1), b('B', 'C', 0, { wicket: { how: 'bowled', out: 'B' } }),
    b('A', 'C', 3), // A returns
  ], { overs: 20 });
  const A = inn.batting.find((x) => x.ref === 'A');
  assert.deepEqual([A.runs, A.balls, A.out, A.how], [9, 3, false, '']);
  assert.equal(inn.wickets, 1);
  inn = replayInnings([b('A', 'B', 1), { type: 'retire', innings: 1, batter: 'B', how: 'retired out' }], { overs: 20, wicketsAvailable: 10 });
  assert.equal(inn.wickets, 1);
  assert.equal(inn.fow[0].batter, 'B');
});
