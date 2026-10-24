// Small dependency-free charts (SVG / HTML). Colours come from CSS variables
// so they follow light, dark and high-contrast themes.
import { esc } from './ui.js';

const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
export const seriesColor = (i) => SERIES[i % SERIES.length];

/** Horizontal bars. rows: [[label, value, (optional) display text]] sorted however you like. */
export function bars(rows, { limit = 10, max, color = 'var(--tool, var(--accent))', empty = 'Nothing yet.' } = {}) {
  if (!rows.length) return `<p class="muted small">${esc(empty)}</p>`;
  const top = max ?? Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="bars">${rows.slice(0, limit).map(([label, n, text]) => `
    <div class="bar-row"><span class="lbl" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="display:block;width:${Math.max(2, (n / top) * 100)}%;background:${color}"></span></span>
      <span class="val">${esc(text ?? n)}</span></div>`).join('')}</div>`;
}

/** Count occurrences: tally(['a','b','a']) -> [['a',2],['b',1]] */
export function tally(items) {
  const m = new Map();
  for (const x of items) if (x !== '' && x != null) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/**
 * Line chart.
 * series: [{ name, points: [[x, y], …], color?, dashed? }]
 * opts: { height, xFmt, yFmt, markers: [{ x, label }], yMin, yMax, area }
 */
export function lineChart(series, { height = 220, xFmt = (x) => x, yFmt = (y) => Math.round(y), markers = [], yMin, yMax, area = false, xLabel = '', yLabel = '' } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return '<p class="muted small">No data yet.</p>';
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 28;
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = yMin ?? Math.min(0, ...pts.map((p) => p[1])), y1 = yMax ?? Math.max(...pts.map((p) => p[1]));
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) y1 = y0 + 1;
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const grid = ticks(y0, y1, 4).map((y) => `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}" class="grid"/><text x="${L - 6}" y="${sy(y) + 4}" text-anchor="end">${esc(yFmt(y))}</text>`).join('');
  // Skip x labels that would read the same as the one before (e.g. #1 #1 #1 on a short count axis).
  const xt = ticks(x0, x1, 5).filter((x, i, arr) => i === 0 || String(xFmt(x)) !== String(xFmt(arr[i - 1]))).map((x) => `<text x="${sx(x)}" y="${H - 8}" text-anchor="middle">${esc(xFmt(x))}</text>`).join('');
  const lines = series.map((s, i) => {
    const c = s.color || seriesColor(i);
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    const fill = area && s.points.length ? `<path d="${d}L${sx(s.points.at(-1)[0])},${sy(y0)}L${sx(s.points[0][0])},${sy(y0)}Z" fill="${c}" opacity=".12" stroke="none"/>` : '';
    const dots = s.points.length <= 40 ? s.points.map((p) => `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="3.5" fill="${c}" stroke="none"><title>${esc(s.name)}: ${esc(yFmt(p[1]))}</title></circle>`).join('') : '';
    return `${fill}<path d="${d}" stroke="${c}" stroke-width="2.5" fill="none" ${s.dashed ? 'stroke-dasharray="6 5"' : ''}/>${dots}`;
  }).join('');
  const mk = markers.map((m) => `<line x1="${sx(m.x)}" x2="${sx(m.x)}" y1="${T}" y2="${H - B}" class="marker"/><text x="${sx(m.x) + 4}" y="${T + 12}" class="mk">${esc(m.label)}</text>`).join('');
  const legend = series.length > 1 ? `<div class="legend" style="margin-top:6px">${series.map((s, i) => `<span><i style="background:${s.color || seriesColor(i)}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))}">${grid}${xt}${mk}${lines}
    ${yLabel ? `<text x="4" y="10" class="axis-label">${esc(yLabel)}</text>` : ''}${xLabel ? `<text x="${W - R}" y="${H - 8}" text-anchor="end" class="axis-label">${esc(xLabel)}</text>` : ''}</svg>${legend}</figure>`;
}

/** Vertical bar chart (e.g. runs per over). values: [[label, value, color?]] */
export function columnChart(values, { height = 180, yFmt = (y) => Math.round(y) } = {}) {
  if (!values.length) return '<p class="muted small">No data yet.</p>';
  const W = 640, H = height, L = 36, B = 22, T = 10;
  const max = Math.max(1, ...values.map((v) => v[1]));
  const bw = (W - L) / values.length;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}">${[0, max / 2, max].map((y) => {
    const yy = T + (1 - y / max) * (H - T - B);
    return `<line x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 4}" y="${yy + 4}" text-anchor="end">${esc(yFmt(y))}</text>`;
  }).join('')}${values.map(([label, v, c], i) => {
    const h = (v / max) * (H - T - B);
    return `<rect x="${L + i * bw + bw * 0.15}" y="${H - B - h}" width="${bw * 0.7}" height="${h}" rx="2" fill="${c || 'var(--tool, var(--accent))'}"><title>${esc(label)}: ${v}</title></rect>${values.length <= 30 ? `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(label)}</text>` : ''}`;
  }).join('')}</svg></figure>`;
}

/** Stacked percentage bar with legend. parts: [[label, value, color]] */
export function stack(parts) {
  const total = parts.reduce((s, p) => s + p[1], 0) || 1;
  return `<div class="stack" role="img" aria-label="${esc(parts.map((p) => `${p[0]} ${p[1]}`).join(', '))}">${parts.map((p) => `<div style="width:${(p[1] / total) * 100}%;background:${p[2]}"></div>`).join('')}</div>
    <div class="legend">${parts.map((p) => `<span><i style="background:${p[2]}"></i>${esc(p[0])} <b>${p[1]}</b></span>`).join('')}</div>`;
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const pctText = (a, b) => (b ? `${pct(a, b)}%` : '–');
