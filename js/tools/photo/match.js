// Pure photo-sorting logic (unit tested): clock offset, matching photos to moments,
// bursts, folder names, captions and Lightroom XMP sidecars.

export const MOMENT_TYPES = [
  { id: 'try', label: 'Try', emoji: '🏉' },
  { id: 'kick', label: 'Kick', emoji: '🦶' },
  { id: 'lineout', label: 'Lineout', emoji: '🙌' },
  { id: 'scrum', label: 'Scrum', emoji: '🤝' },
  { id: 'tackle', label: 'Big tackle', emoji: '💥' },
  { id: 'line_break', label: 'Line break', emoji: '⚡' },
  { id: 'celebration', label: 'Celebration', emoji: '🎉' },
  { id: 'team_photo', label: 'Team photo', emoji: '📸' },
  { id: 'handshakes', label: 'Handshakes', emoji: '🤝' },
  { id: 'other', label: 'Other', emoji: '⭐' },
];
export const momentLabel = (type) => MOMENT_TYPES.find((m) => m.id === type)?.label || 'Moment';

/** Sports events that also count as photo moments (rugby/hockey live logging). */
const EVENT_MOMENT = {
  try: 'try', conv: 'kick', conv_miss: 'kick', pen_goal: 'kick', pen_miss: 'kick', drop_goal: 'kick',
  lineout_won: 'lineout', lineout_lost: 'lineout', scrum_won: 'scrum', scrum_lost: 'scrum', line_break: 'line_break', turnover: 'tackle',
  goal: 'try', pc_goal: 'try', yellow: 'other', red: 'other',
};
export const eventToMomentType = (type) => EVENT_MOMENT[type] || null;

/**
 * Camera clock offset from the clock-sync photo.
 * cameraMs: the photo's EXIF time (as the camera saw it); shownMs: the time on the phone screen in that photo.
 * Positive = camera clock is ahead.
 */
export const clockOffset = (cameraMs, shownMs) => cameraMs - shownMs;
export const trueTime = (cameraMs, offsetMs) => cameraMs - (offsetMs || 0);

/** Parse the phone clock QR: "HBCLK:<epoch ms>" */
export function parseClockQr(text) {
  const m = String(text || '').match(/HBCLK:(\d{12,14})/);
  return m ? Number(m[1]) : null;
}

/**
 * Typed time "14:32:07" (or 2:32:07 pm) on the same day as `refMs` → epoch ms (local time).
 * Picks the day (ref ±1) that lands closest to refMs, in case the camera clock crossed midnight.
 */
export function shownTimeFromText(text, refMs) {
  const m = String(text || '').trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2})(?:[.,](\d{1,3}))?)?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = +m[1];
  if (m[5]) { h %= 12; if (/pm/i.test(m[5])) h += 12; }
  const base = new Date(refMs);
  const cands = [-1, 0, 1].map((d) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, h, +m[2], +(m[3] || 0), +((m[4] || '0').padEnd(3, '0'))).getTime());
  return cands.sort((a, b) => Math.abs(a - refMs) - Math.abs(b - refMs))[0];
}

/**
 * Match photos to the nearest moment within ±windowMs.
 * photos: [{ id, takenAt }] (takenAt already corrected); moments: [{ id, t }].
 * Returns Map(photoId -> momentId | null). Photos are matched to moments slightly
 * *after* the shutter too (you often tap the button after taking the shot).
 */
export function matchPhotos(photos, moments, windowMs = 15000) {
  const ms = [...moments].sort((a, b) => a.t - b.t);
  const out = new Map();
  for (const p of photos) {
    if (p.takenAt == null) { out.set(p.id, null); continue; }
    // Binary search for the nearest moment.
    let lo = 0, hi = ms.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ms[mid].t < p.takenAt) lo = mid + 1; else hi = mid - 1;
    }
    for (const i of [lo - 1, lo]) {
      const m = ms[i];
      if (!m) continue;
      const d = Math.abs(m.t - p.takenAt);
      if (d <= windowMs && (!best || d < best.d)) best = { id: m.id, d };
    }
    out.set(p.id, best?.id ?? null);
  }
  return out;
}

/** Group photos into bursts: consecutive frames less than gapMs apart. Returns Map(photoId -> burstIndex). */
export function bursts(photos, gapMs = 1000) {
  const sorted = photos.filter((p) => p.takenAt != null).sort((a, b) => a.takenAt - b.takenAt);
  const out = new Map();
  let idx = -1, prev = null;
  for (const p of sorted) {
    if (prev == null || p.takenAt - prev > gapMs) idx++;
    out.set(p.id, idx);
    prev = p.takenAt;
  }
  return out;
}

const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** "Try – #11 – 34:12" (match clock) or "Try – #11 – 15:04:33" (time of day when no clock). */
export function collectionName(moment) {
  const parts = [momentLabel(moment.type)];
  if (moment.number) parts.push(`#${moment.number}`);
  parts.push(moment.matchMs != null ? mmss(moment.matchMs) : new Date(moment.t).toTimeString().slice(0, 8));
  return parts.join(' – ');
}

/** Safe folder/file name for every OS. */
export const safeName = (s) => String(s).replace(/[\u2013\u2014]/g, '-').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';

/** "Frontage 1st XV v Riverside RFC – Try by #11 Jo Brown, 34th minute" */
export function caption({ matchTitle, moment, playerName }) {
  const bits = [matchTitle];
  if (moment) {
    let what = momentLabel(moment.type);
    if (moment.number || playerName) what += ` by ${moment.number ? `#${moment.number}` : ''}${playerName ? `${moment.number ? ' ' : ''}${playerName}` : ''}`;
    if (moment.matchMs != null) what += `, ${ordinal(Math.floor(moment.matchMs / 60000) + 1)} minute`;
    bits.push(what);
  }
  return bits.join(' – ');
}
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

/** Lightroom-compatible XMP sidecar with rating, keywords and caption. */
export function xmpSidecar({ rating = 0, keywords = [], caption: cap = '', pick = false }) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="HomeBase">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmp:Rating="${Number(rating) || 0}"${pick ? '\n    xmp:Label="Green"' : ''}>
   <dc:subject><rdf:Bag>${keywords.map((k) => `<rdf:li>${xmlEsc(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>
   <lr:hierarchicalSubject><rdf:Bag>${keywords.map((k) => `<rdf:li>HomeBase|${xmlEsc(k)}</rdf:li>`).join('')}</rdf:Bag></lr:hierarchicalSubject>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(cap)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
export const sidecarName = (fileName) => fileName.replace(/\.[^.]+$/, '') + '.xmp';

/** Which logged standing spot was I at when this photo was taken? (last position logged before it) */
export function spotAt(positions, takenAt) {
  let best = null;
  for (const p of positions) if (p.t <= takenAt && (!best || p.t > best.t)) best = p;
  return best?.spot || null;
}
