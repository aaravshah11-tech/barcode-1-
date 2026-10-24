// Lookup tests with recorded API responses (no network needed).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookupIsbn, parseOpenLibrary, parseGoogle, cleanSubjects, languageName } from '../js/tools/library/lookup.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let routes;
beforeEach(() => {
  routes = {};
  globalThis.fetch = async (url) => {
    for (const [pattern, handler] of Object.entries(routes)) if (String(url).includes(pattern)) return handler(url);
    if (String(url).includes('googleapis')) return json({ kind: 'books#volumes', totalItems: 0 });
    if (String(url).includes('/api/books')) return json({});
    return new Response('not found', { status: 404 });
  };
});

test('9780747532699 via Open Library (with work description)', async () => {
  routes['/api/books'] = () => json(fx('ol-9780747532699'));
  routes['/isbn/9780747532699.json'] = () => json(fx('ol-edition-9780747532699'));
  routes['/works/OL82563W.json'] = () => json(fx('ol-work-OL82563W'));
  const b = await lookupIsbn('9780747532699');
  assert.equal(b.title, "Harry Potter and the Philosopher's Stone");
  assert.deepEqual(b.authors, ['J. K. Rowling']);
  assert.equal(b.publisher, 'Bloomsbury');
  assert.equal(b.year, '1997');
  assert.equal(b.pages, 223);
  assert.equal(b.language, 'English');
  assert.equal(b.cover, 'https://covers.openlibrary.org/b/id/10521270-L.jpg');
  assert.match(b.description, /Hogwarts/);
  assert.deepEqual(b.subjects, ['Wizards', 'Juvenile fiction', 'Magic', 'Schools', 'Fiction']);
  assert.equal(b.isbn10, '0747532699');
  assert.equal(b.source, 'openlibrary');
});

test('9780141439518 falls back to Google Books', async () => {
  routes['googleapis'] = () => json(fx('google-9780141439518'));
  const b = await lookupIsbn('9780141439518');
  assert.equal(b.title, 'Pride and Prejudice');
  assert.deepEqual(b.authors, ['Jane Austen']);
  assert.equal(b.publisher, 'Penguin UK');
  assert.equal(b.year, '2003');
  assert.equal(b.pages, 480);
  assert.equal(b.language, 'English');
  assert.deepEqual(b.subjects, ['Fiction']);
  assert.match(b.cover, /^https:\/\/books\.google\.com\/.*zoom=1/);
  assert.doesNotMatch(b.cover, /edge=curl/);
  assert.equal(b.description, 'Few have failed to be charmed by the witty and independent spirit of Elizabeth Bennet.');
  assert.equal(b.source, 'google');
});

test('Google fills gaps Open Library leaves', async () => {
  routes['/api/books'] = () => json({ 'ISBN:9780141439518': { title: 'Pride and Prejudice', authors: [{ name: 'Jane Austen' }], publish_date: 'Jan 30, 2003' } });
  routes['googleapis'] = () => json(fx('google-9780141439518'));
  const b = await lookupIsbn('9780141439518');
  assert.equal(b.source, 'openlibrary');
  assert.equal(b.pages, 480);
  assert.equal(b.year, '2003');
  assert.match(b.cover, /books\.google/);
  assert.match(b.description, /Elizabeth Bennet/);
});

test('unknown book returns null', async () => {
  assert.equal(await lookupIsbn('9780000000002'), null);
});

test('network failure is reported as offline', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(lookupIsbn('9780747532699'), (e) => e.offline === true);
});

test('Google rate limit alone does not hide an Open Library hit', async () => {
  routes['/api/books'] = () => json(fx('ol-9780747532699'));
  routes['googleapis'] = () => json({ error: { code: 429 } }, 429);
  const b = await lookupIsbn('9780747532699');
  assert.equal(b.title, "Harry Potter and the Philosopher's Stone");
});

test('helpers', () => {
  assert.equal(languageName('/languages/fre'), 'French');
  assert.equal(languageName('de'), 'German');
  assert.deepEqual(cleanSubjects(['Fiction', 'fiction', 'Fiction / Classics', 'nyt:x=1', 'Large type books', 'A'.repeat(50)]), ['Fiction']);
  assert.equal(parseOpenLibrary(null, null), null);
  assert.equal(parseGoogle({ totalItems: 0 }), null);
});
