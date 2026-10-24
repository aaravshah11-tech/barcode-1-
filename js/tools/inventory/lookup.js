// Product lookup by barcode: Open Food Facts (food, drink, toiletries) and UPCitemdb (everything else).
const TIMEOUT = 8000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const CATEGORY_WORDS = [
  ['Electronics', /electronic|computer|phone|camera|audio|video|tv|cable|charger|headphone|battery|console/i],
  ['Tools', /tool|hardware|drill|screw|garden tool|hand tool|power tool/i],
  ['Kitchen', /kitchen|cook|bakeware|utensil|appliance|dining|tableware/i],
  ['Sports', /sport|fitness|outdoor|camping|bike|cycling|ball|golf|rugby|cricket|hockey/i],
  ['Toys & games', /toy|game|puzzle|lego|doll/i],
  ['Clothing', /cloth|apparel|shoe|fashion|wear|jacket|shirt/i],
  ['Garden', /garden|lawn|plant|patio/i],
  ['Books & media', /book|dvd|blu-ray|music|cd|vinyl|media/i],
  ['Food & drink', /food|beverage|drink|snack|grocery|en:/i],
];
export const guessCategory = (text) => CATEGORY_WORDS.find(([, re]) => re.test(text || ''))?.[0] || '';

export function parseOff(json) {
  const p = json?.status === 1 ? json.product : null;
  if (!p?.product_name) return null;
  return {
    name: [p.product_name, p.quantity].filter(Boolean).join(' '),
    brand: (p.brands || '').split(',')[0].trim(),
    category: 'Food & drink',
    photo: p.image_front_small_url || p.image_small_url || p.image_url || '',
    source: 'Open Food Facts',
  };
}

export function parseUpc(json) {
  const it = json?.items?.[0];
  if (!it?.title) return null;
  return {
    name: it.title,
    brand: it.brand || '',
    category: guessCategory(`${it.category} ${it.title}`),
    photo: (it.images || []).find((u) => /^https:/.test(u)) || '',
    value: it.lowest_recorded_price || '',
    source: 'UPCitemdb',
  };
}

/** Resolves to product info, or null if not found. Throws { offline: true } when there's no internet. */
export async function lookupBarcode(code) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Object.assign(new Error('offline'), { offline: true });
  const [off, upc] = await Promise.allSettled([
    getJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,quantity,image_front_small_url,image_small_url,image_url`),
    getJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`),
  ]);
  const hit = parseOff(off.value) || parseUpc(upc.value);
  if (!hit && off.status === 'rejected' && upc.status === 'rejected') throw Object.assign(new Error('network'), { offline: true });
  return hit ? { ...hit, barcode: code } : null;
}
