// Frame-differencing motion detector (pure — no camera code, so it can be unit tested).
// Compares each frame with a slowly-updating "what the room normally looks like" background.
export function makeDetector({ W, H, cols = 8, rows = 6 }) {
  let bg = null;
  let frames = 0;
  let hot = 0;
  return {
    reset() { bg = null; frames = 0; hot = 0; },
    /**
     * frame: Uint8ClampedArray W×H brightness. opts: { sensitivity 1–10, ignore: [cell numbers] }
     * Returns { motion, fraction, cells: [changed cell numbers], lighting } — `motion` only after 2 busy frames in a row.
     */
    step(frame, { sensitivity = 6, ignore = [] } = {}) {
      frames++;
      if (!bg) { bg = Float32Array.from(frame); return { motion: false, fraction: 0, cells: [], lighting: false }; }
      const pixThresh = 42 - sensitivity * 2.6; // how much one pixel must change
      const need = (11 - sensitivity) * 0.006; // share of the watched picture that must change
      const skip = new Set(ignore);
      const cellCount = new Array(cols * rows).fill(0);
      let changed = 0, watched = 0;
      for (let y = 0; y < H; y++) {
        const cy = Math.min(rows - 1, Math.floor((y * rows) / H));
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const c = cy * cols + Math.min(cols - 1, Math.floor((x * cols) / W));
          const d = Math.abs(frame[i] - bg[i]);
          bg[i] = bg[i] * 0.92 + frame[i] * 0.08; // adapt slowly (clouds, dusk)
          if (skip.has(c)) continue;
          watched++;
          if (d > pixThresh) { changed++; cellCount[c]++; }
        }
      }
      const fraction = watched ? changed / watched : 0;
      const perCell = (W / cols) * (H / rows);
      const cells = cellCount.map((n, i) => (n / perCell > 0.08 ? i : -1)).filter((i) => i >= 0);
      // Almost everything changed at once = lights switched on/off or the camera adjusting, not someone moving.
      if (fraction > 0.65 || frames < 6) { bg = Float32Array.from(frame); hot = 0; return { motion: false, fraction, cells: [], lighting: fraction > 0.65 }; }
      hot = fraction > need ? hot + 1 : 0;
      return { motion: hot >= 2, fraction, cells, lighting: false };
    },
  };
}
