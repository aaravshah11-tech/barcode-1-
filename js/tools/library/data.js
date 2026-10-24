// Library data helpers on top of the shared HomeBase store.
import * as core from '../../core/store.js';
import * as L from '../../core/locations.js';
import { family, addFamily } from '../../core/people.js';
import * as sync from '../../sync/manager.js';

export const STATUSES = [
  { id: 'unread', label: 'Unread' },
  { id: 'reading', label: 'Reading' },
  { id: 'read', label: 'Read' },
];

const DEFAULTS = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: [], publisher: '', year: '', pages: 0, subjects: [], description: '',
  language: '', cover: '', source: 'manual', location: null, owner: '', status: 'unread', rating: 0, notes: '', favourite: false,
  lentTo: '', lentDate: '', needsLookup: false, incomplete: false,
};

export const allBooks = () => core.all('books');
export const getBook = (id) => core.get('books', id);
export const findByIsbn = (isbn13) => (isbn13 ? allBooks().filter((b) => b.isbn13 === isbn13) : []);
export function saveBook(b) {
  const prev = b.id ? getBook(b.id) : null;
  return core.put('books', { ...DEFAULTS, ...prev, ...b, addedAt: prev?.addedAt || b.addedAt || Date.now() });
}
export const updateBook = (id, patch) => core.patch('books', id, patch);
export const deleteBook = (id) => core.remove('books', id);
export const restoreBook = (prev) => core.restore('books', prev);
export const onChange = core.onChange;

// Device-only preferences for this tool (last location, batch settings…).
export const getSetting = (k, d = null) => core.getLocal(`library.${k}`, d);
export const setSetting = (k, v) => core.setLocal(`library.${k}`, v);

// Shared house locations.
export const allRooms = L.allRooms;
export const getRoom = L.getRoom;
export const locationLabel = L.locationLabel;
export function locationParts(loc) {
  const p = L.locationParts(loc);
  return { room: p.room, bookcase: p.area, shelf: p.spot };
}

export const owners = family;
export const addOwner = addFamily;

/** Phone ↔ computer status in the shape the Library screens expect. */
export const link = {
  getState() {
    const s = sync.getState();
    return { role: s.mode === 'off' ? null : sync.isPhoneSide() ? 'guest' : 'host', state: s.state, devices: s.devices || [] };
  },
  onState: (fn) => sync.onState(() => fn(link.getState())),
  codeFromText: (t) => (sync.parsePairing(t) ? t : ''),
};
