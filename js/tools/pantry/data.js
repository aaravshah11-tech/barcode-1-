// Pantry data: food in the house ('pantry'), the shopping list ('shopping'),
// and what we've learnt about products by barcode ('pantryProducts', id = barcode).
import * as store from '../../core/store.js';
import { shelfDays } from './logic.js';

export const pantry = () => store.all('pantry');
export const getFood = (id) => store.get('pantry', id);
export const byBarcode = (code) => (code ? pantry().filter((p) => p.barcode === code) : []);
export const product = (code) => (code ? store.get('pantryProducts', code) : null);
export const shopping = () => store.all('shopping').sort((a, b) => (a.done - b.done) || (b.addedAt || 0) - (a.addedAt || 0));

export async function saveFood(f) {
  const isNew = !f.id;
  const rec = await store.put('pantry', { quantity: 1, storage: 'cupboard', expiry: '', ...f, addedAt: f.addedAt || Date.now() });
  // Bought it: take it off the shopping list.
  if (isNew) {
    const name = (rec.name || '').toLowerCase();
    for (const s of store.all('shopping')) if ((rec.barcode && s.barcode === rec.barcode) || s.name.toLowerCase() === name) await store.remove('shopping', s.id);
  }
  if (rec.barcode) {
    const prev = product(rec.barcode) || {};
    await store.put('pantryProducts', { ...prev, id: rec.barcode, name: rec.name, brand: rec.brand || prev.brand || '', photo: rec.photo || prev.photo || '', storage: rec.storage, shelfDays: shelfDays(rec) ?? prev.shelfDays ?? null });
  }
  return rec;
}
export const removeFood = (id) => store.remove('pantry', id);
export const restoreFood = (prev) => store.restore('pantry', prev);

export async function addToShopping(name, extra = {}) {
  const n = name.trim();
  if (!n) return null;
  const same = store.all('shopping').find((s) => !s.done && s.name.toLowerCase() === n.toLowerCase());
  if (same) return store.put('shopping', { ...same, qty: (same.qty || 1) + (extra.qty || 1) });
  return store.put('shopping', { name: n, qty: 1, done: false, addedAt: Date.now(), ...extra });
}
