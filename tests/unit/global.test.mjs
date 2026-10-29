import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeArcs, latLonToVec, distanceKm, bearing, bboxAround, compass, subsolar } from '../../shared/geo.js';
import { parseOpenSky, parseAdsbLol, nearby, flightLevel, parseQuakes, parseNews, validMmsi, mmsiCountry, argosLink, cleanShips, parseHash, makeHash } from '../../shared/feeds.js';
import { parseTle, satrecOf, issAt, groundTrack, nextPasses, lookFrom } from '../../shared/iss.js';
import { readFileSync } from 'node:fs';

const LONDON = { lat: 51.51, lon: -0.13 };

test('earth maths', () => {
  const [x, y, z] = latLonToVec(0, 0); assert.deepEqual([Math.round(x), Math.round(y), Math.round(z)], [0, 0, 1]);
  assert.ok(Math.abs(latLonToVec(90, 0)[1] - 1) < 1e-9, 'north pole is up');
  const paris = { lat: 48.857, lon: 2.352 };
  assert.ok(Math.abs(distanceKm(LONDON, paris) - 344) < 5, 'London–Paris ≈ 344 km');
  assert.ok(Math.abs(bearing(LONDON, paris) - 148) < 3, 'Paris is south-east of London');
  assert.equal(compass(148), 'SE'); assert.equal(compass(359), 'N');
  const b = bboxAround(LONDON, 50); assert.ok(b.lamax - b.lamin > 0.8 && b.lomax - b.lomin > b.lamax - b.lamin, 'longitude span wider at 51°N');
  const s = subsolar(Date.parse('2024-06-21T12:00:00Z'));
  assert.ok(Math.abs(s.lat - 23.44) < 0.2 && Math.abs(s.lon - 0) < 1.5, `midsummer noon UTC: sun overhead near 23.4°N 0°E (got ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)})`);
  const world = JSON.parse(readFileSync(new URL('../../vendor/world/countries-110m.json', import.meta.url)));
  const arcs = decodeArcs(world);
  assert.ok(arcs.length > 500 && arcs.every((a) => a.every(([lo, la]) => lo >= -180.01 && lo <= 180.01 && la >= -90 && la <= 90)), 'country outlines decode to real coordinates');
});

test('aircraft feeds', () => {
  const os = parseOpenSky({ states: [['4ca7b5', 'RYR4KD  ', 'Ireland', 0, 0, -0.2, 51.6, 10668, false, 230, 87.5, 0, null, 10900, '7000', false, 0], ['abc', '', 'X', 0, 0, null, null]] });
  assert.equal(os.length, 1); assert.equal(os[0].callsign, 'RYR4KD'); assert.equal(os[0].altFt, 35000); assert.equal(os[0].speedKt, 447);
  const al = parseAdsbLol({ ac: [{ hex: '406a1b', flight: 'BAW12 ', lat: 51.47, lon: -0.45, alt_baro: 'ground', gs: 12, track: 270, t: 'A388', r: 'G-XLEA' }] });
  assert.equal(al[0].callsign, 'BAW12'); assert.equal(al[0].onGround, true); assert.equal(al[0].type, 'A388');
  const n = nearby([...os, ...al, { id: 'far', lat: 55, lon: 3 }], LONDON, 60);
  assert.deepEqual(n.map((a) => a.id), ['4ca7b5', '406a1b'], 'nearest first, far ones dropped');
  assert.ok(n[0].km < 15 && n[0].brg > 270 || n[0].brg < 360);
  assert.equal(flightLevel(35000), 'FL350'); assert.equal(flightLevel(2300), '2,300 ft'); assert.equal(flightLevel(null), '—');
});

test('quakes, news, ships, links', () => {
  const q = parseQuakes({ features: [
    { id: 'a', properties: { mag: 4.46, place: '10 km S of X', time: 1000, url: 'u' }, geometry: { coordinates: [10, 20, 33.2] } },
    { id: 'b', properties: { mag: 6.1, place: 'Y', time: 2000, tsunami: 1 }, geometry: { coordinates: [-70, -30, 10] } }] });
  assert.deepEqual(q.map((x) => x.id), ['b', 'a']); assert.equal(q[1].mag, 4.5); assert.equal(q[1].depth, 33); assert.equal(q[0].tsunami, true);
  const news = parseNews({ articles: [{ title: 'Big  story', url: 'https://a', domain: 'bbc.co.uk', seendate: '20261029T101500Z' }, { title: 'big story', url: 'https://b' }, { title: '', url: 'x' }] });
  assert.equal(news.length, 1); assert.equal(news[0].title, 'Big story'); assert.equal(news[0].at, Date.UTC(2026, 9, 29, 10, 15));
  assert.ok(validMmsi('235052123') && !validMmsi('23505212') && !validMmsi('abc'));
  assert.equal(mmsiCountry('235052123'), 'United Kingdom');
  assert.equal(argosLink('235052123'), 'https://argosatlas.com/map/#ship=235052123');
  assert.deepEqual(cleanShips(['235052123', { mmsi: '235052123' }, 'bad', { mmsi: '366999000', name: '<b>Ever</b>' }]), [{ mmsi: '235052123', name: '' }, { mmsi: '366999000', name: 'bEver/b' }]);
  assert.deepEqual(parseHash('#ship=235052123'), { type: 'ship', id: '235052123' });
  assert.deepEqual(parseHash('#iss'), { type: 'iss' });
  assert.equal(parseHash('#nonsense'), null);
  assert.equal(makeHash({ type: 'flight', id: 'BAW12' }), '#flight=BAW12');
});

// An ISS orbit from 2024 (for repeatable tests).
const TLE = `ISS (ZARYA)
1 25544U 98067A   24173.50000000  .00016717  00000-0  30030-3 0  9993
2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560830460000`;

test('the ISS: position, track and passes over home', () => {
  const tle = parseTle(TLE);
  assert.equal(tle.name, 'ISS (ZARYA)');
  assert.throws(() => parseTle('hello'), /TLE/);
  const sr = satrecOf(tle), t = Date.parse('2024-06-21T12:00:00Z');
  const p = issAt(sr, t);
  assert.ok(p.altKm > 380 && p.altKm < 440, `altitude ~410 km (got ${p.altKm})`);
  assert.ok(p.speedKmh > 27000 && p.speedKmh < 28500, `speed ~27,600 km/h (got ${p.speedKmh})`);
  assert.ok(Math.abs(p.lat) <= 51.7, 'never further north or south than its 51.6° tilt');
  const track = groundTrack(sr, t, 45, 90, 5);
  assert.equal(track.length, 28);
  const passes = nextPasses(sr, LONDON, t, { hours: 48 });
  assert.ok(passes.length >= 2, `London sees several passes in 2 days (got ${passes.length})`);
  for (const ps of passes) {
    assert.ok(ps.start < ps.maxAt && ps.maxAt < ps.end && ps.end - ps.start < 12 * 60000, 'a pass lasts a few minutes');
    assert.ok(ps.maxEl >= 10 && ps.maxEl <= 90);
    assert.ok(lookFrom(sr, LONDON, ps.maxAt).el > lookFrom(sr, LONDON, ps.start + 10000).el);
  }
});
