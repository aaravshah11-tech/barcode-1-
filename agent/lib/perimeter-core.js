// PERIMETER WATCH logic that doesn't touch the camera (pure, unit tested).
// The picture is split into an 8 × 6 grid. Privacy-masked squares are blacked out BEFORE anything looks
// at the picture; ignore squares are looked at but never reported.
export const COLS = 8, ROWS = 6;

/** What a recognised object counts as. Anything else (a chair, a plant…) is never reported. */
export const GROUPS = {
  person: 'person',
  car: 'vehicle', truck: 'vehicle', bus: 'vehicle', motorcycle: 'vehicle', bicycle: 'vehicle',
  cat: 'animal', dog: 'animal', bird: 'animal', horse: 'animal', sheep: 'animal', cow: 'animal', bear: 'animal',
};
export const GROUP_LABEL = { person: 'Person', vehicle: 'Vehicle', animal: 'Animal', motion: 'Movement' };
export const WATCH_LABEL = { front: 'front / driveway', garden: 'garden', garage: 'garage / shed' };
const ALLOWED = { people: ['person'], people_vehicles: ['person', 'vehicle'], all: ['person', 'vehicle', 'animal'] };

/** Which grid square a point (in a w × h picture) falls in. */
export function cellOf(x, y, w, h) {
  const c = Math.min(COLS - 1, Math.max(0, Math.floor((x / w) * COLS)));
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor((y / h) * ROWS)));
  return r * COLS + c;
}

/** Rectangles (in a w × h picture) to paint black for the masked squares. */
export function maskRects(cells, w, h) {
  const cw = w / COLS, ch = h / ROWS;
  return [...new Set(cells)].filter((i) => i >= 0 && i < COLS * ROWS)
    .map((i) => [Math.floor((i % COLS) * cw), Math.floor(Math.floor(i / COLS) * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1]);
}

/** Black out the masked squares of a greyscale frame (W × H), in place. Returns the frame. */
export function maskFrame(frame, W, H, cells) {
  if (!cells?.length) return frame;
  const set = new Set(cells);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (set.has(cellOf(x + 0.5, y + 0.5, W, H))) frame[y * W + x] = 0;
  return frame;
}

/**
 * The detection worth reporting, or null. dets = [{ class, score, bbox: [x, y, w, h] }] from the recogniser
 * (run on the already-masked picture). An object whose centre is in a masked or ignored square is dropped.
 */
export function pickDetection(dets, { classes = 'people_vehicles', confidence = 55, mask = [], ignore = [], w, h }) {
  const ok = ALLOWED[classes] || ALLOWED.people_vehicles;
  const skip = new Set([...mask, ...ignore]);
  const order = { person: 0, vehicle: 1, animal: 2 };
  const list = (dets || []).map((d) => {
    const group = GROUPS[d.class];
    if (!group || !ok.includes(group) || !(d.score * 100 >= confidence) || !Array.isArray(d.bbox)) return null;
    const [x, y, bw, bh] = d.bbox, cell = cellOf(x + bw / 2, y + bh / 2, w, h);
    if (skip.has(cell)) return null;
    return { group, label: d.class, score: Math.round(d.score * 100), cell, box: [x / w, y / h, bw / w, bh / h] };
  }).filter(Boolean);
  list.sort((a, b) => order[a.group] - order[b.group] || b.score - a.score);
  return list[0] || null;
}

/** The text HQ receives, e.g. "Person detected (front / driveway)". */
export const describe = (group, watch) => `${GROUP_LABEL[group] || 'Movement'} ${group === 'motion' ? 'seen' : 'detected'} (${WATCH_LABEL[watch] || watch})${group === 'motion' ? ' — motion only' : ''}`;

/** Is object recognition too slow on this device? (average of the last 5 checks over 2.5 s) */
export function makeSpeedGuard(limitMs = 2500) {
  const times = [];
  return {
    add(ms) { times.push(ms); if (times.length > 5) times.shift(); },
    get slow() { return times.length >= 3 && times.reduce((a, b) => a + b, 0) / times.length > limitMs; },
    get avg() { return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null; },
  };
}
