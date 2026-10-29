// Small time charts (battery, link time) with a hover/touch read-out. One line, thin marks, quiet axes.
import { esc } from '../shared/ui.js';

const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * points: [[t, value|null], …] (null = gap). t0/t1: time range. max: top of the scale.
 * label: the chart's title (names the series). unit: e.g. '%' or ' ms'. threshold: a dashed reference line.
 * shade: [[from, to], …] time spans to tint (e.g. while charging), shadeLabel says what they mean.
 */
export function timeChart({ points, t0, t1, max, min = 0, label, unit = '', threshold = null, thresholdLabel = '', shade = [], shadeLabel = '', empty = 'No readings yet.', current = null }) {
  const vals = points.filter((p) => p[1] != null);
  if (vals.length < 2) return `<figure class="tchart"><figcaption class="small muted">${esc(label)}</figcaption><p class="small muted" style="margin:4px 0 0">${esc(empty)}</p></figure>`;
  const W = 300, H = 70, top = 6, bottom = 14;
  const x = (t) => ((t - t0) / (t1 - t0)) * W;
  const y = (v) => top + (1 - (v - min) / (max - min)) * (H - top - bottom);
  let d = '', pen = false, prevT = null;
  for (const [t, v] of points) {
    const gap = prevT != null && t - prevT > 45 * 60000; // no readings for a while (Agent off) → break the line
    if (v == null || gap) pen = false;
    if (v != null) { d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }
    prevT = t;
  }
  const shades = shade.map(([a, b]) => `<rect x="${x(Math.max(a, t0)).toFixed(1)}" y="${top}" width="${Math.max(1, x(Math.min(b, t1)) - x(Math.max(a, t0))).toFixed(1)}" height="${H - top - bottom}" class="shade"/>`).join('');
  const ticks = [t0, (t0 + t1) / 2, t1].map((t, i) => `<text x="${x(t)}" y="${H - 2}" text-anchor="${['start', 'middle', 'end'][i]}">${i === 2 ? 'now' : hm(t)}</text>`).join('');
  const last = current != null ? [t1, current] : vals.at(-1); // header shows the live value when known
  return `<figure class="tchart" data-points='${esc(JSON.stringify(points))}' data-range="${t0},${t1}" data-unit="${esc(unit)}">
    <figcaption><span class="small muted">${esc(label)}</span><b class="mono small">${Math.round(last[1])}${esc(unit)}</b></figcaption>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`${label}: latest ${Math.round(last[1])}${unit}`)}">
      ${shades}<line x1="0" x2="${W}" y1="${y(min)}" y2="${y(min)}" class="axis"/>
      ${threshold != null ? `<line x1="0" x2="${W}" y1="${y(threshold)}" y2="${y(threshold)}" class="thresh"/>` : ''}
      <path d="${d}" class="line"/>${ticks}<line class="cross" x1="0" x2="0" y1="${top}" y2="${H - bottom}" hidden/></svg>
    ${threshold != null || shade.length ? `<div class="tlegend small muted">${threshold != null ? `<span><i class="k-thresh"></i>${esc(thresholdLabel)}</span>` : ''}${shade.length ? `<span><i class="k-shade"></i>${esc(shadeLabel)}</span>` : ''}</div>` : ''}
    <div class="tip mono" hidden></div></figure>`;
}

document.addEventListener('pointermove', (e) => {
  const fig = e.target.closest?.('.tchart[data-points]');
  document.querySelectorAll('.tchart .tip').forEach((t) => { if (!fig || !fig.contains(t)) { t.hidden = true; t.parentElement.querySelector('.cross')?.setAttribute('hidden', ''); } });
  if (!fig) return;
  const pts = JSON.parse(fig.dataset.points).filter((p) => p[1] != null);
  const [t0, t1] = fig.dataset.range.split(',').map(Number);
  const svg = fig.querySelector('svg'), r = svg.getBoundingClientRect();
  const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
  const p = pts.reduce((best, q) => (Math.abs(q[0] - t) < Math.abs(best[0] - t) ? q : best), pts[0]);
  const cx = ((p[0] - t0) / (t1 - t0)) * 300, cross = svg.querySelector('.cross'), tip = fig.querySelector('.tip');
  cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('hidden');
  tip.hidden = false;
  tip.textContent = `${hm(p[0])} · ${Math.round(p[1])}${fig.dataset.unit}`;
  tip.style.left = `${Math.min(r.width - 90, Math.max(0, e.clientX - r.left - 40))}px`;
});
