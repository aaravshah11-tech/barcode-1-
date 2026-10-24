// Inventory data helpers.
import * as store from '../../core/store.js';

export const DEFAULT_CATEGORIES = ['Electronics', 'Tools', 'Kitchen', 'Sports', 'Toys & games', 'Clothing', 'Documents', 'Garden', 'Decorations', 'Food & drink', 'Books & media', 'Other'];
export const CONDITIONS = [
  { id: 'new', label: 'New' }, { id: 'good', label: 'Good' }, { id: 'fair', label: 'Fair' }, { id: 'poor', label: 'Poor' }, { id: 'broken', label: 'Broken' },
];

const DEFAULTS = { name: '', brand: '', category: '', location: null, quantity: 1, owner: '', condition: 'good', value: '', notes: '', photo: '', barcode: '', lentTo: '', lentDate: '' };

export const items = () => store.all('items');
export const item = (id) => store.get('items', id);
export const byBarcode = (code) => (code ? items().filter((i) => i.barcode === code) : []);
export const saveItem = (i) => store.put('items', { ...DEFAULTS, ...(i.id ? item(i.id) : {}), ...i });
export const categories = () => store.setting('inventory.categories', DEFAULT_CATEGORIES);
export async function addCategory(name) {
  name = name.trim();
  if (name && !categories().includes(name)) await store.setSetting('inventory.categories', [...categories(), name]);
}
export const setCategories = (list) => store.setSetting('inventory.categories', list);
export const currency = () => store.setting('inventory.currency', 'GBP');

export function money(v) {
  const n = Number(v);
  if (!v && v !== 0) return '';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency(), maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch { return String(n); }
}
export const totalValue = (list) => list.reduce((s, i) => s + (Number(i.value) || 0) * (Number(i.quantity) || 1), 0);

/** Items in a place (spot-level match if given, otherwise the whole area/room). */
export function itemsAt(loc) {
  return items().filter((i) => i.location?.roomId === loc.roomId && (!loc.areaId || i.location.areaId === loc.areaId) && (!loc.spotId || i.location.spotId === loc.spotId));
}
