import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDoor } from '../../agent/lib/door-core.js';

const play = (d, steps) => steps.flatMap(([rate, ms]) => { const out = []; for (let t = 0; t < ms; t += 20) { const r = d.step(rate, 20); if (r) out.push(r); } return out; });

test('door swings open past the angle, then closes', () => {
  const d = makeDoor({ angle: 12 });
  const ev = play(d, [[{ gamma: 0 }, 2000], [{ gamma: 60 }, 500], [{}, 1500], [{ gamma: -60 }, 500], [{}, 1500]]);
  assert.deepEqual(ev, ['opened', 'closed']);
});
test('small wobble (someone walking past) is not a door opening', () => {
  const d = makeDoor({ angle: 12 });
  assert.deepEqual(play(d, [[{ gamma: 20 }, 200], [{}, 400], [{ gamma: -20 }, 200], [{}, 2000]]), []);
});
test('sensor noise below the rest level does not drift into an opening', () => {
  const d = makeDoor({ angle: 12 });
  assert.deepEqual(play(d, Array.from({ length: 200 }, (_, i) => [{ alpha: (i % 2 ? 4.5 : -1), beta: 3 }, 100])), []);
  assert.deepEqual(play(makeDoor({ angle: 12 }), [[{ gamma: 7 }, 1000], [{}, 2000], [{ gamma: -7 }, 1000], [{}, 2000]]), [], 'a small slow push that never reaches the angle');
});
test('works whichever way the phone is stuck on', () => {
  const d = makeDoor({ angle: 15 });
  assert.deepEqual(play(d, [[{ alpha: -45 }, 600], [{}, 1000], [{ alpha: 45 }, 600], [{}, 1500]]), ['opened', 'closed']);
});
