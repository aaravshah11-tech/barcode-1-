// Global search: every tool can offer results through its hooks.js `search(q)`.
// The scoring here is pure (no DOM, no storage) and unit tested.

/** Lower-case, accents removed, so "Café" matches "cafe". Plain-ASCII text (most of it) takes a fast path;
 *  other results are cached because the same titles are searched again on every keystroke. */
const normCache = new Map();
export function norm(s) {
  const str = String(s ?? '');
  if (/^[\x00-\x7f]*$/.test(str)) return str.toLowerCase();
  let v = normCache.get(str);
  if (v === undefined) {
    v = str.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (normCache.size > 20000) normCache.clear();
    normCache.set(str, v);
  }
  return v;
}
export const tokens = (q) => norm(q).split(/[\s,]+/).filter(Boolean);

/**
 * Score one record. fields: [[text, weight], …]. Every word of the query must appear somewhere.
 * A word matching the start of a field scores most, the start of a word next, anywhere least.
 * Returns 0 for no match.
 */
export function scoreFields(fields, words) {
  if (!words.length) return 0;
  const f = fields.filter(([t]) => t != null && t !== '').map(([t, w]) => [norm(Array.isArray(t) ? t.join(' ') : t), w]);
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const [text, w] of f) {
      const i = text.indexOf(word);
      if (i < 0) continue;
      const lead = /^(the|a|an) /.exec(text)?.[0].length || 0; // "The Hobbit" starts with "hobbit"
      const s = (text === word ? 6 : i === 0 || i === lead ? 4 : /[\s\-–(/.'"]/.test(text[i - 1]) ? 2.5 : 1) * w;
      if (s > best) best = s;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** Search a list of records: map(record) gives { fields, ...result }. Returns the best `limit` results. */
export function searchList(list, q, map, limit = 50) {
  const words = tokens(q);
  if (!words.length) return [];
  const out = [];
  for (const r of list) {
    const m = map(r);
    const score = scoreFields(m.fields, words);
    if (score) { const { fields, ...res } = m; out.push({ ...res, score }); }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Exact code match (ISBN / barcode), ignoring spaces and dashes. */
export const sameCode = (a, b) => !!a && !!b && String(a).replace(/[\s-]/g, '') === String(b).replace(/[\s-]/g, '');
