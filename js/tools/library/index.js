// 📚 Library tool: scan and find books in the house.
import * as library from './library.js';
import * as scan from './scan.js';
import * as book from './book.js';
import * as stats from './stats.js';
import * as store from './data.js';
import { downloadCsv, csvDate } from '../../core/csv.js';

const COLUMNS = [
  ['Title', (b) => b.title], ['Subtitle', (b) => b.subtitle], ['Authors', (b) => (b.authors || []).join('; ')],
  ['ISBN-13', (b) => b.isbn13], ['ISBN-10', (b) => b.isbn10], ['Publisher', (b) => b.publisher], ['Year', (b) => b.year],
  ['Pages', (b) => b.pages || ''], ['Language', (b) => b.language], ['Genres', (b) => (b.subjects || []).join('; ')],
  ['Room', (b) => store.locationParts(b.location).room], ['Area', (b) => store.locationParts(b.location).bookcase], ['Shelf', (b) => store.locationParts(b.location).shelf],
  ['Owner', (b) => b.owner], ['Status', (b) => b.status], ['Rating', (b) => b.rating || ''], ['Favourite', (b) => (b.favourite ? 'yes' : '')],
  ['Lent to', (b) => b.lentTo], ['Lent date', (b) => (b.lentTo ? b.lentDate : '')], ['Date added', (b) => csvDate(b.addedAt || b.createdAt)],
  ['Notes', (b) => b.notes], ['Description', (b) => b.description],
];

export default {
  routes: {
    '': library.render,
    scan: scan.render,
    find: (root) => scan.render(root, ['where']),
    book: book.render,
    stats: stats.render,
  },
  nav: [
    { route: '', label: 'Books', icon: 'book', match: ['', 'book'] },
    { route: 'find', label: 'Where is it?', icon: 'search' },
    { route: 'scan', label: 'Scan', icon: 'qr', primary: true },
    { route: 'stats', label: 'Stats', icon: 'chart' },
  ],
  exports: [{ label: 'Books (CSV)', run: () => downloadCsv('library-books', COLUMNS, store.allBooks().sort((a, b) => a.title.localeCompare(b.title))) }],
};
