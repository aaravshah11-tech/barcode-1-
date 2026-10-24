// Export / import of the whole library.
import * as store from './store.js';
import { download } from './ui.js';

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJson() {
  const data = {
    app: 'shelf',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: store.allBooks(),
    rooms: store.allRooms(),
    owners: store.owners(),
  };
  download(`shelf-backup-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  return data.books.length;
}

const CSV_COLUMNS = [
  ['Title', (b) => b.title],
  ['Subtitle', (b) => b.subtitle],
  ['Authors', (b) => (b.authors || []).join('; ')],
  ['ISBN-13', (b) => b.isbn13],
  ['ISBN-10', (b) => b.isbn10],
  ['Publisher', (b) => b.publisher],
  ['Year', (b) => b.year],
  ['Pages', (b) => b.pages || ''],
  ['Language', (b) => b.language],
  ['Genres', (b) => (b.subjects || []).join('; ')],
  ['Room', (b) => store.locationParts(b.location).room],
  ['Bookcase', (b) => store.locationParts(b.location).bookcase],
  ['Shelf', (b) => (b.location?.roomId ? b.location.shelf ?? '' : '')],
  ['Owner', (b) => b.owner],
  ['Status', (b) => b.status],
  ['Rating', (b) => b.rating || ''],
  ['Favourite', (b) => (b.favourite ? 'yes' : '')],
  ['Lent to', (b) => b.lentTo],
  ['Lent date', (b) => (b.lentTo ? b.lentDate : '')],
  ['Date added', (b) => (b.addedAt ? new Date(b.addedAt).toISOString().slice(0, 10) : '')],
  ['Notes', (b) => b.notes],
  ['Description', (b) => b.description],
];

export function toCsv(books) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')];
  for (const b of books) lines.push(CSV_COLUMNS.map(([, f]) => cell(f(b))).join(','));
  return lines.join('\r\n');
}

export function exportCsv() {
  const books = store.allBooks().sort((a, b) => a.title.localeCompare(b.title));
  // BOM so Excel opens accents correctly.
  download(`shelf-library-${stamp()}.csv`, '﻿' + toCsv(books), 'text/csv;charset=utf-8');
  return books.length;
}

export async function importJsonFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file isn’t a valid JSON backup.');
  }
  if (Array.isArray(data)) data = { books: data };
  if (!data || !Array.isArray(data.books)) throw new Error('No books found in that file. Choose a Shelf backup (.json).');
  return store.importRecords(data);
}
