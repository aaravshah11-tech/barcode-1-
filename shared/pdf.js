// A small PDF writer (no libraries): A4 pages, text in the three built-in PDF fonts, lines and
// filled boxes — enough for SENTINEL's reports and charts. Coordinates are in points from the TOP-left.

const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
/** Characters outside plain ASCII that the built-in fonts have (Windows-1252 codes) and their widths. */
const EXTRA = { '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500], '”': [0x94, 333, 500], '•': [0x95, 350, 350], '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], '…': [0x85, 1000, 1000], '·': [0xb7, 278, 278], '°': [0xb0, 400, 400], '×': [0xd7, 584, 584], '£': [0xa3, 556, 556], '€': [0x80, 556, 556], 'é': [0xe9, 556, 556], 'è': [0xe8, 556, 556], 'ö': [0xf6, 556, 611], 'ü': [0xfc, 556, 611], 'ä': [0xe4, 556, 556], '²': [0xb2, 333, 333], '±': [0xb1, 584, 584] };
const SWAP = { '→': '->', '←': '<-', '✓': 'v', '✗': 'x', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '≥': '>=', '≤': '<=' };
const FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Courier' };

/** Text → Windows-1252 bytes the built-in fonts understand (anything else becomes ?). */
export function encodeText(s) {
  const out = [];
  for (let ch of String(s ?? '')) {
    if (SWAP[ch]) { for (const c of SWAP[ch]) out.push(c.charCodeAt(0)); continue; }
    const c = ch.charCodeAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (EXTRA[ch]) out.push(EXTRA[ch][0]);
    else if (ch === '\t') out.push(32);
    else out.push(63);
  }
  return out;
}
/** Width of a string in points. font: 'F1' (regular), 'F2' (bold), 'F3' (mono). */
export function textWidth(s, size = 10, font = 'F1') {
  if (font === 'F3') return [...String(s ?? '')].length * 0.6 * size;
  const tab = font === 'F2' ? BOLD : HELV;
  let w = 0;
  for (let ch of String(s ?? '')) {
    if (SWAP[ch]) { w += [...SWAP[ch]].reduce((t, c) => t + tab[c.charCodeAt(0) - 32], 0); continue; }
    const c = ch.charCodeAt(0);
    w += c >= 32 && c < 127 ? tab[c - 32] : EXTRA[ch] ? EXTRA[ch][font === 'F2' ? 2 : 1] : 556;
  }
  return (w / 1000) * size;
}
/** Break text into lines no wider than `width`. */
export function wrap(s, width, size = 10, font = 'F1') {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, font) <= width || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
const n = (v) => (Math.round(v * 100) / 100).toString();
const rgb = (c) => (typeof c === 'string' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) : c).map(n).join(' ');

export class Pdf {
  constructor({ width = 595.28, height = 841.89, title = 'SENTINEL report' } = {}) {
    this.W = width; this.H = height; this.title = title; this.pages = []; this.cur = null;
  }
  addPage() { this.cur = []; this.pages.push(this.cur); return this; }
  ops(s) { if (!this.cur) this.addPage(); this.cur.push(s); }
  text(x, y, s, { size = 10, font = 'F1', color = '#1b2430', align = 'left' } = {}) {
    const w = align === 'left' ? 0 : textWidth(s, size, font);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops(`BT /${font} ${n(size)} Tf ${rgb(color)} rg ${n(tx)} ${n(this.H - y)} Td <${hex(encodeText(s))}> Tj ET`);
    return this;
  }
  rect(x, y, w, h, { fill = null, stroke = null, width = 0.5 } = {}) {
    let s = 'q ';
    if (fill) s += `${rgb(fill)} rg `;
    if (stroke) s += `${rgb(stroke)} RG ${n(width)} w `;
    s += `${n(x)} ${n(this.H - y - h)} ${n(w)} ${n(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`;
    this.ops(s);
    return this;
  }
  line(x1, y1, x2, y2, { color = '#c4ccd6', width = 0.5 } = {}) {
    this.ops(`q ${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(this.H - y1)} m ${n(x2)} ${n(this.H - y2)} l S Q`);
    return this;
  }
  /** The finished file as bytes. */
  output() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const fontIds = Object.entries(FONTS).map(([k, f]) => [k, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`)]);
    const fontDict = fontIds.map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
    const kids = [];
    for (const p of this.pages.length ? this.pages : [[]]) {
      const body = p.join('\n');
      const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(this.W)} ${n(this.H)}] /Resources << /Font << ${fontDict} >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title <${hex(encodeText(this.title))}> /Producer (SENTINEL) >>`);
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}
