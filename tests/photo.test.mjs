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

test('RAW previews: biggest viewable JPEG wins, lossless sensor data is skipped', async () => {
  const { findJpegs, largestJpeg, findExifTiff } = await import('../js/tools/photo/raw.js');
  const { readFileSync } = await import('node:fs');
  const jpeg = (w, h, filler = 10) => [0xFF, 0xD8, 0xFF, 0xC0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0,
    0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 0x3F, 0, ...Array(filler).fill(0x12), 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56, 0xFF, 0xD9];
  const lossless = [0xFF, 0xD8, 0xFF, 0xC3, 0, 11, 8, 0x10, 0, 0x10, 0, 1, 1, 0x11, 0, 0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 0x3F, 0, 1, 2, 0xFF, 0xD9];
  const bytes = new Uint8Array([0x49, 0x49, 0x2A, 0, ...Array(20).fill(0), ...jpeg(160, 120), 0, 0, ...lossless, 7, 7, ...jpeg(1620, 1080, 50), 0, 0]);
  const found = findJpegs(bytes);
  assert.deepEqual(found.map((j) => [j.width, j.height]), [[160, 120], [1620, 1080]]);
  assert.deepEqual([largestJpeg(bytes).width, largestJpeg(bytes).height], [1620, 1080]);
  assert.equal(largestJpeg(new Uint8Array([1, 2, 3])), null);
  // The sample NEF (TIFF + thumbnail + preview) and HEIC from make-photo-fixtures.py
  const nef = new Uint8Array(readFileSync(new URL('./fixtures/photos/RAW_0401.NEF', import.meta.url)));
  assert.deepEqual([largestJpeg(nef).width, largestJpeg(nef).height], [1200, 800]);
  const heic = new Uint8Array(readFileSync(new URL('./fixtures/photos/IMG_0501.HEIC', import.meta.url)));
  assert.ok(findExifTiff(heic) > 0);
});

test('ZIP writer makes a valid archive', async () => {
  const { makeZip, crc32 } = await import('../js/tools/photo/zip.js');
  assert.equal(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414FA339);
  const zip = await makeZip([
    { name: '2026-10-24 Match/01 Try - #11/IMG_0101.JPG', data: new Blob([new Uint8Array([1, 2, 3, 4, 5])]), date: new Date(2026, 9, 24, 15, 10, 0) },
    { name: '2026-10-24 Match/captions.csv', data: 'File,Caption\nIMG_0101.JPG,Try – by #11\n' },
  ]);
  const { writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const path = `/tmp/homebase-zip-test-${process.pid}.zip`;
  writeFileSync(path, Buffer.from(await zip.arrayBuffer()));
  let out;
  try {
    out = execFileSync('python3', ['-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(";".join(f"{i.filename}:{i.file_size}" for i in z.infolist())); print(z.read("2026-10-24 Match/captions.csv").decode())`, path]).toString();
  } catch (e) { if (/ENOENT/.test(e.message)) return; throw e; } // no python: skip the external check
  assert.match(out, /01 Try - #11\/IMG_0101\.JPG:5;2026-10-24 Match\/captions\.csv:\d+/);
  assert.match(out, /Try – by #11/);
});
