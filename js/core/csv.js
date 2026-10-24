// CSV export helper.
import { download } from './ui.js';

/** columns: [[header, row => value], …] */
export function toCsv(columns, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(([h]) => cell(h)).join(','), ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(','))].join('\r\n');
}

export const csvDate = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);

/** Download a CSV (with a BOM so Excel shows accents properly). */
export function downloadCsv(name, columns, rows) {
  download(`${name}-${today()}.csv`, '﻿' + toCsv(columns, rows), 'text/csv;charset=utf-8');
  return rows.length;
}
