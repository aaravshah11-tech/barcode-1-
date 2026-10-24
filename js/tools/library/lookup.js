// Book lookup by ISBN: Open Library first, Google Books fills the gaps.
import { isbn13to10 } from './isbn.js';

const TIMEOUT_MS = 8000;

export class LookupError extends Error {
  constructor(message, { offline = false } = {}) {
    super(message);
    this.offline = offline;
  }
}

async function fetchJson(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- parsing helpers (exported for tests) ----------
const MARC_LANGS = {
  eng: 'English', fre: 'French', fra: 'French', ger: 'German', deu: 'German', spa: 'Spanish', ita: 'Italian',
  por: 'Portuguese', dut: 'Dutch', nld: 'Dutch', swe: 'Swedish', dan: 'Danish', nor: 'Norwegian', fin: 'Finnish',
  pol: 'Polish', rus: 'Russian', jpn: 'Japanese', chi: 'Chinese', zho: 'Chinese', kor: 'Korean', ara: 'Arabic',
  heb: 'Hebrew', hin: 'Hindi', guj: 'Gujarati', urd: 'Urdu', ben: 'Bengali', pan: 'Punjabi', tam: 'Tamil',
  tur: 'Turkish', gre: 'Greek', ell: 'Greek', lat: 'Latin', wel: 'Welsh', cym: 'Welsh', gle: 'Irish', cze: 'Czech',
  ces: 'Czech', hun: 'Hungarian', rum: 'Romanian', ron: 'Romanian', ukr: 'Ukrainian', ice: 'Icelandic', isl: 'Icelandic',
};

export function languageName(code) {
  if (!code) return '';
  code = String(code).replace('/languages/', '').toLowerCase();
  if (MARC_LANGS[code]) return MARC_LANGS[code];
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

const yearOf = (s) => (String(s || '').match(/\b(1[4-9]\d\d|20\d\d)\b/) || [])[1] || '';
const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
const textOf = (d) => (typeof d === 'string' ? d : d?.value || '');

/** Tidy up subject lists: drop catalogue codes and very long headings, dedupe, cap the count. */
export function cleanSubjects(list, max = 8) {
  const seen = new Set();
  const out = [];
  for (let s of list || []) {
    s = String(s || '').split(/\s+--\s+|\s*\/\s*|,\s*/)[0].trim();
    if (!s || s.length > 32 || /[:=]|\d{3,}/.test(s) || /^(accessible book|protected daisy|in library|lending library|large type books|open library)/i.test(s)) continue;
    s = s.charAt(0).toUpperCase() + s.slice(1);
    const k = s.toLowerCase().replace(/s$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Parse Open Library `api/books?jscmd=data` entry plus optional `/isbn/X.json` edition record. */
export function parseOpenLibrary(data, edition) {
  if (!data && !edition) return null;
  data = data || {};
  edition = edition || {};
  const title = data.title || edition.title;
  if (!title) return null;
  const coverId = Array.isArray(edition.covers) ? edition.covers.find((c) => c > 0) : null;
  return {
    title,
    subtitle: data.subtitle || edition.subtitle || '',
    authors: (data.authors || []).map((a) => a.name).filter(Boolean),
    publisher: data.publishers?.[0]?.name || edition.publishers?.[0] || '',
    year: yearOf(data.publish_date || edition.publish_date),
    pages: data.number_of_pages || edition.number_of_pages || 0,
    subjects: (data.subjects || []).map((s) => s.name || s),
    description: stripHtml(textOf(edition.description)),
    language: languageName(edition.languages?.[0]?.key),
    cover: data.cover?.large || data.cover?.medium || (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : ''),
    workKey: edition.works?.[0]?.key || '',
  };
}

/** Parse a Google Books `volumes?q=isbn:` response. */
export function parseGoogle(json, isbn13) {
  const items = json?.items || [];
  const match =
    items.find((it) => (it.volumeInfo?.industryIdentifiers || []).some((id) => id.identifier === isbn13)) || items[0];
  const v = match?.volumeInfo;
  if (!v?.title) return null;
  const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
  return {
    title: v.title,
    subtitle: v.subtitle || '',
    authors: v.authors || [],
    publisher: v.publisher || '',
    year: yearOf(v.publishedDate),
    pages: v.pageCount || 0,
    subjects: (v.categories || []).flatMap((c) => c.split('/').map((x) => x.trim())),
    description: stripHtml(v.description),
    language: languageName(v.language),
    cover: img ? img.replace(/^http:/, 'https:').replace('&edge=curl', '') : '',
  };
}

/** Combine both sources, Open Library first, Google filling anything empty. */
export function mergeInfo(ol, g) {
  if (!ol && !g) return null;
  const a = ol || {}, b = g || {};
  const has = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
  const pick = (k) => (has(a[k]) ? a[k] : has(b[k]) ? b[k] : k === 'authors' ? [] : '');
  return {
    title: pick('title'),
    subtitle: pick('subtitle'),
    authors: pick('authors'),
    publisher: pick('publisher'),
    year: pick('year'),
    pages: a.pages || b.pages || 0,
    // Google's categories are cleaner genres, so list them first.
    subjects: cleanSubjects([...(b.subjects || []), ...(a.subjects || [])]),
    description: pick('description'),
    language: pick('language'),
    cover: pick('cover'),
    source: ol ? 'openlibrary' : 'google',
  };
}

/**
 * Look a book up. Resolves to book info, or null if neither service knows it.
 * Throws LookupError({offline:true}) when there's no internet.
 */
export async function lookupIsbn(isbn13) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new LookupError("You're offline", { offline: true });
  }
  const [olData, olEd, gb] = await Promise.allSettled([
    fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`),
    fetchJson(`https://openlibrary.org/isbn/${isbn13}.json`),
    fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`),
  ]);
  const ol = parseOpenLibrary(olData.value?.[`ISBN:${isbn13}`], olEd.value);
  const g = parseGoogle(gb.value, isbn13);
  if (!ol && !g) {
    if ([olData, olEd, gb].every((r) => r.status === 'rejected')) {
      throw new LookupError("Couldn't reach the book databases. Check your internet connection.", { offline: true });
    }
    return null;
  }
  const info = mergeInfo(ol, g);
  // Descriptions usually live on the Open Library "work", not the edition.
  if (!info.description && ol?.workKey) {
    try {
      const work = await fetchJson(`https://openlibrary.org${ol.workKey}.json`, 4000);
      info.description = stripHtml(textOf(work?.description));
      if (!info.subjects.length) info.subjects = cleanSubjects(work?.subjects);
    } catch { /* optional */ }
  }
  return { ...info, isbn13, isbn10: isbn13to10(isbn13) };
}
