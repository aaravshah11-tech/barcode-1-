import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIsbn13, isbn13to10, isValidIsbn10, isValidIsbn13, prettyIsbn } from '../js/isbn.js';

test('accepts valid ISBN-13s (with or without dashes)', () => {
  assert.equal(toIsbn13('9780747532699'), '9780747532699');
  assert.equal(toIsbn13('978-0-14-143951-8'), '9780141439518');
  assert.equal(toIsbn13(' 979-10-90636-07-1 '), '9791090636071');
});

test('converts ISBN-10 to ISBN-13 and back', () => {
  assert.equal(toIsbn13('0747532699'), '9780747532699');
  assert.equal(toIsbn13('0-14-143951-3'), '9780141439518');
  assert.equal(toIsbn13('080442957X'), '9780804429573');
  assert.equal(isbn13to10('9780747532699'), '0747532699');
  assert.equal(isbn13to10('9780804429573'), '080442957X');
  assert.equal(isbn13to10('9791090636071'), '');
});

test('rejects non-book barcodes and typos', () => {
  assert.equal(toIsbn13('9780747532698'), null); // bad check digit
  assert.equal(toIsbn13('5000112637922'), null); // a Coke can (EAN-13, not 978/979)
  assert.equal(toIsbn13('12345'), null);
  assert.equal(toIsbn13(''), null);
  assert.equal(isValidIsbn10('0747532698'), false);
  assert.equal(isValidIsbn13('9780141439518'), true);
});

test('pretty prints', () => {
  assert.equal(prettyIsbn('9780747532699'), '978-0-7475-3269-9');
});
