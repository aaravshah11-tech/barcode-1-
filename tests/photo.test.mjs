import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockOffset, trueTime, parseClockQr, shownTimeFromText, matchPhotos, bursts, collectionName, caption, xmpSidecar, sidecarName, safeName, spotAt, ordinal } from '../js/tools/photo/match.js';

test('camera clock offset and correction', () => {
  const shown = Date.UTC(2026, 9, 24, 14, 0, 0);
  const camera = shown + 83500; // camera is 1m23.5s fast
  const off = clockOffset(camera, shown);
  assert.equal(off, 83500);
  assert.equal(trueTime(camera + 60000, off), shown + 60000);
  assert.equal(parseClockQr('HBCLK:1792850842798'), 1792850842798);
  assert.equal(parseClockQr('nope'), null);
});

test('typed time on the photo', () => {
  const ref = new Date(2026, 9, 24, 14, 32, 30).getTime();
  assert.equal(shownTimeFromText('14:32:07', ref), new Date(2026, 9, 24, 14, 32, 7).getTime());
  assert.equal(shownTimeFromText('2:32:07 pm', ref), new Date(2026, 9, 24, 14, 32, 7).getTime());
  assert.equal(shownTimeFromText('14:32:07.5', ref), new Date(2026, 9, 24, 14, 32, 7, 500).getTime());
  // camera says 00:00:20 on the 25th but the phone showed 23:59:50 on the 24th
  const late = new Date(2026, 9, 25, 0, 0, 20).getTime();
  assert.equal(shownTimeFromText('23:59:50', late), new Date(2026, 9, 24, 23, 59, 50).getTime());
  assert.equal(shownTimeFromText('banana', ref), null);
});

test('photos match the nearest moment within the window', () => {
  const moments = [{ id: 'try1', t: 100000 }, { id: 'kick', t: 160000 }, { id: 'try2', t: 400000 }];
  const photos = [
    { id: 'a', takenAt: 95000 }, { id: 'b', takenAt: 104000 }, { id: 'c', takenAt: 131000 }, { id: 'd', takenAt: 150000 },
    { id: 'e', takenAt: 390000 }, { id: 'f', takenAt: 250000 }, { id: 'g', takenAt: null },
  ];
  const m = matchPhotos(photos, moments, 15000);
  assert.deepEqual(Object.fromEntries(m), { a: 'try1', b: 'try1', c: null, d: 'kick', e: 'try2', f: null, g: null });
  assert.equal(matchPhotos([{ id: 'c', takenAt: 131000 }], moments, 31000).get('c'), 'kick'); // 29s vs 31s
});

test('bursts', () => {
  const b = bursts([{ id: 1, takenAt: 1000 }, { id: 2, takenAt: 1200 }, { id: 3, takenAt: 1900 }, { id: 4, takenAt: 5000 }, { id: 5, takenAt: 5100 }]);
  assert.deepEqual([...b.values()], [0, 0, 0, 1, 1]);
});

test('names, captions, XMP', () => {
  assert.equal(collectionName({ type: 'try', number: 11, matchMs: 34 * 60000 + 12000 }), 'Try – #11 – 34:12');
  assert.equal(caption({ matchTitle: 'Frontage 1st XV v Riverside RFC', moment: { type: 'try', number: 11, matchMs: 33 * 60000 + 5000 }, playerName: 'Jo Brown' }),
    'Frontage 1st XV v Riverside RFC – Try by #11 Jo Brown, 34th minute');
  assert.equal(ordinal(1) + ordinal(2) + ordinal(3) + ordinal(11) + ordinal(22), '1st2nd3rd11th22nd');
  const x = xmpSidecar({ rating: 4, keywords: ['Rugby', 'Try', '#11'], caption: 'A & B', pick: true });
  assert.match(x, /xmp:Rating="4"/);
  assert.match(x, /<rdf:li>#11<\/rdf:li>/);
  assert.match(x, /A &amp; B/);
  assert.equal(sidecarName('IMG_1234.CR2'), 'IMG_1234.xmp');
  assert.equal(safeName('Try – #11 – 34:12'), 'Try - #11 - 34-12');
  assert.equal(spotAt([{ spot: 'corner', t: 10 }, { spot: 'posts', t: 50 }], 40), 'corner');
  assert.equal(spotAt([{ spot: 'corner', t: 10 }], 5), null);
});
