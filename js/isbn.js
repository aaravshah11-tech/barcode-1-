// ISBN helpers: cleaning, validation and ISBN-10 <-> ISBN-13 conversion.

export function cleanIsbn(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : +s[i]) * (10 - i);
  return sum % 11 === 0;
}

function checkDigit13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +first12[i] * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn13(s) {
  return /^\d{13}$/.test(s) && checkDigit13(s.slice(0, 12)) === s[12];
}

export function isbn10to13(isbn10) {
  const base = '978' + isbn10.slice(0, 9);
  return base + checkDigit13(base);
}

/** ISBN-13 -> ISBN-10. Only 978-prefixed ISBNs have an ISBN-10. */
export function isbn13to10(isbn13) {
  if (!isbn13 || !isbn13.startsWith('978')) return '';
  const body = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +body[i] * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return body + (c === 10 ? 'X' : String(c));
}

/**
 * Turn anything that looks like an ISBN (typed or scanned) into a valid ISBN-13,
 * or return null if it is not a book ISBN.
 */
export function toIsbn13(raw) {
  const s = cleanIsbn(raw);
  if (s.length === 13 && isValidIsbn13(s) && (s.startsWith('978') || s.startsWith('979'))) return s;
  if (s.length === 10 && isValidIsbn10(s)) return isbn10to13(s);
  return null;
}

/** Pretty-print an ISBN-13 as 978-0-00-000000-0 style groups (approximate, for readability). */
export function prettyIsbn(isbn13) {
  if (!isbn13 || isbn13.length !== 13) return isbn13 || '';
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 8)}-${isbn13.slice(8, 12)}-${isbn13.slice(12)}`;
}
