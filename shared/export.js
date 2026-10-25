// Mission Log export as CSV (opens in Excel / Numbers / Google Sheets).
const cell = (v) => {
  const s = v == null ? '' : String(v);
  // Quote when needed; a leading = + - @ is neutralised so spreadsheets don't treat text as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function toCsv(events, agents = new Map()) {
  const head = ['Time (UTC)', 'Local time', 'Level', 'Kind', 'Agent', 'Message', 'Data'];
  const rows = events.map((e) => {
    const a = agents.get(e.agentId);
    return [new Date(e.ts).toISOString(), new Date(e.ts).toLocaleString('en-GB'), e.level, e.kind, a ? `${a.codename}` : '', e.message, e.data ? JSON.stringify(e.data) : ''];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
