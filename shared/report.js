// REPORTS: the daily SITREP, the weekly report and custom reports — one data builder, two outputs
// (on-screen and PDF). Pure: everything it needs is passed in.
import { Pdf, wrap, textWidth } from './pdf.js';
import { ACTIVITY_KINDS } from './threat.js';
import { uptimePct } from './register.js';
import { SEV_RANK } from './triage.js';

export const CLASSIFICATION = 'SENTINEL // RESTRICTED – HOUSEHOLD';
export const SECTIONS = [
  ['summary', 'Summary and key figures'], ['activity', 'Activity by day and by room'], ['alerts', 'Alerts and triage'], ['incidents', 'Incidents'],
  ['anomalies', 'Anomalies and correlations'], ['agents', 'Agents'], ['network', 'Network'], ['states', 'Alert state changes'], ['log', 'Full event log'],
];
export const ALL_SECTIONS = SECTIONS.map(([k]) => k).filter((k) => k !== 'log');
const DAY = 86400000;
const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDT = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
export const isoWeek = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4); return { year: d.getFullYear(), week: 1 + Math.round(((d - w1) / DAY - 3 + ((w1.getDay() + 6) % 7)) / 7) }; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const mins = (ms) => (ms == null ? '—' : ms < 60000 ? '<1 min' : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 360000) / 10} h`);
const strip = (m) => String(m || '').replace(/^AGENT-\d+ [A-Z0-9 _-]+: /, '');

/**
 * Everything a report needs, for the period [from, to).
 * input = { from, to, events, alerts, incidents, agents, house, anomalies, matches, netDays, outages, filter: { rooms?, agents?, minSeverity? } }
 */
export function reportData(input) {
  const { from, to } = input;
  const f = input.filter || {};
  const roomOf = new Map();
  for (const fl of input.house?.floors || []) for (const r of fl.rooms) roomOf.set(r.id, r.name);
  const agentRoom = (id) => { const a = input.agents.find((x) => x.id === id); return a?.place?.roomId ? roomOf.get(a.place.roomId) || '' : ''; };
  const keepAgent = (id) => (!f.agents?.length || f.agents.includes(id)) && (!f.rooms?.length || f.rooms.includes(input.agents.find((x) => x.id === id)?.place?.roomId));
  const inP = (t) => t >= from && t < to;
  const events = input.events.filter((e) => inP(e.ts) && (!e.agentId || keepAgent(e.agentId)));
  const minRank = SEV_RANK[f.minSeverity] || 1;
  const alerts = input.alerts.filter((a) => inP(a.ts) && SEV_RANK[a.severity] >= minRank && (!a.agentId || keepAgent(a.agentId)));
  const activity = events.filter((e) => ACTIVITY_KINDS.has(e.kind));
  // per day
  const days = [];
  for (let t = midnight(from); t < to; t += DAY) days.push({ day: t, label: fmtDay(t), activity: 0, alerts: 0 });
  const dayIdx = (t) => days.findIndex((d) => t >= d.day && t < d.day + DAY);
  for (const e of activity) { const i = dayIdx(e.ts); if (i >= 0) days[i].activity++; }
  for (const a of alerts) { const i = dayIdx(a.ts); if (i >= 0) days[i].alerts++; }
  // per room
  const rooms = new Map();
  for (const e of activity) { const r = agentRoom(e.agentId) || 'Not on the plan'; rooms.set(r, (rooms.get(r) || 0) + 1); }
  // alerts
  const bySev = Object.fromEntries(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => [s, alerts.filter((a) => a.severity === s).length]));
  const handled = alerts.filter((a) => a.handledAt);
  const mtta = handled.length ? handled.reduce((s, a) => s + (a.handledAt - a.ts), 0) / handled.length : null;
  const byStatus = {}; for (const a of alerts) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  const dismissReasons = {}; for (const a of alerts.filter((x) => x.dismissReason)) dismissReasons[a.dismissReason] = (dismissReasons[a.dismissReason] || 0) + 1;
  const incidents = input.incidents.filter((i) => inP(i.createdAt) || (i.updatedAt >= from && i.createdAt < to));
  const states = events.filter((e) => e.kind === 'system' && /^Security mode:|^Alert state:/.test(e.message)).map((e) => ({ ts: e.ts, text: e.message }));
  const agents = input.agents.filter((a) => keepAgent(a.id)).map((a) => ({
    label: `${a.label || ''} ${a.codename}`.trim(), mission: a.missionName || a.mission, room: agentRoom(a.id) || '—', online: !!a.online,
    uptime: uptimePct(input.events, a.id, from, Math.min(to, input.now ?? to), a.online), battery: a.battery, tampers: events.filter((e) => e.kind === 'tamper' && e.agentId === a.id).length,
  }));
  const netDays = (input.netDays || []).filter((d) => { const t = new Date(`${d.day}T12:00:00`).getTime(); return t >= from && t < to; });
  const checks = netDays.reduce((s, d) => s + d.checks, 0), up = netDays.reduce((s, d) => s + (d.up ?? Math.round((d.uptime / 100) * d.checks)), 0);
  const outages = (input.outages || []).filter((o) => o.from < to && (o.to ?? to) >= from);
  const newDevices = events.filter((e) => e.kind === 'device' && e.data?.new).map((e) => ({ ts: e.ts, text: e.message }));
  return {
    from, to, totals: { events: events.length, activity: activity.length, alerts: alerts.length, critical: bySev.CRITICAL + bySev.HIGH, incidentsOpened: incidents.filter((i) => inP(i.createdAt)).length, unhandled: alerts.filter((a) => a.status === 'new').length },
    days, rooms: [...rooms].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    alerts: { bySev, byStatus, mtta, mttaText: mins(mtta), dismissReasons, notable: alerts.filter((a) => SEV_RANK[a.severity] >= 3).sort((a, b) => a.ts - b.ts).slice(0, 25).map((a) => ({ ts: a.ts, id: a.id, severity: a.severity, title: a.title, status: a.status })) },
    incidents: incidents.map((i) => ({ ref: i.ref, title: i.title, severity: i.severity, status: i.status, assignee: i.assignee, createdAt: i.createdAt })),
    anomalies: (input.anomalies || []).filter((a) => inP(a.ts)).map((a) => ({ ts: a.ts, title: a.title, confidence: a.confidence, reason: a.reason })),
    correlations: (input.matches || []).filter((m) => inP(m.ts)).map((m) => ({ ts: m.ts, text: m.text })),
    agents, states,
    network: { uptime: pct(up, checks), outages: outages.map((o) => ({ from: o.from, to: o.to })), downMs: outages.reduce((s, o) => s + (Math.min(o.to ?? to, to) - Math.max(o.from, from)), 0), newDevices },
    log: events.slice(0, 2000).map((e) => ({ ts: e.ts, kind: e.kind, level: e.level, text: strip(e.message) })),
  };
}

/** The SITREP: short numbered paragraphs, the way a situation report is written. */
export function sitrepText(d, { state = 'HOME', threat = 'GREEN', agentsOnline = 0, agentsTotal = 0, actions = [] } = {}) {
  const t = d.totals, s = d.alerts.bySev;
  const out = [];
  out.push({ h: '1. Situation', lines: [`Alert state ${state}. Threat level ${threat}. ${agentsOnline} of ${agentsTotal} Agent${agentsTotal === 1 ? '' : 's'} online.`, ...(d.states.length ? [`Alert state changed ${d.states.length} time${d.states.length === 1 ? '' : 's'}: ${d.states.map((x) => `${fmtDT(x.ts)} ${x.text.replace(/^(Security mode|Alert state): /, '').split(' — ')[0]}`).join('; ')}.`] : [])] });
  out.push({ h: '2. Activity', lines: [`${t.activity} sensor event${t.activity === 1 ? '' : 's'} recorded.${d.rooms.length ? ` Busiest: ${d.rooms.slice(0, 3).map((r) => `${r.name} (${r.count})`).join(', ')}.` : ''}`] });
  out.push({ h: '3. Alerts and incidents', lines: [t.alerts ? `${t.alerts} alert${t.alerts === 1 ? '' : 's'}: ${s.CRITICAL} critical, ${s.HIGH} high, ${s.MEDIUM} medium, ${s.LOW} low. ${t.unhandled} still unhandled. Average time to first action ${d.alerts.mttaText}.` : 'No alerts.', ...(d.incidents.length ? [`Incidents: ${d.incidents.map((i) => `${i.ref} ${i.title} (${i.status})`).join('; ')}.`] : []), ...d.alerts.notable.slice(0, 5).map((a) => `${fmtDT(a.ts)} ${a.severity} — ${a.title}.`)] });
  if (d.anomalies.length || d.correlations.length) out.push({ h: '4. Analysis', lines: [...d.anomalies.slice(0, 5).map((a) => `${fmtDT(a.ts)} ${a.title} (${a.confidence}% confidence).`), ...d.correlations.slice(0, 5).map((c) => `${fmtDT(c.ts)} ${c.text}.`)] });
  out.push({ h: `${out.length + 1}. Equipment and network`, lines: [
    `${d.agents.filter((a) => a.tampers).length ? `Tamper reports: ${d.agents.filter((a) => a.tampers).map((a) => `${a.label} (${a.tampers})`).join(', ')}. ` : 'No tamper reports. '}${d.agents.filter((a) => a.battery != null && a.battery < 0.2).map((a) => `${a.label} battery ${Math.round(a.battery * 100)}%`).join(', ')}`.trim(),
    `${d.network.uptime != null ? `Internet uptime ${d.network.uptime}%` : 'Internet uptime not recorded (HQ was closed)'}${d.network.outages.length ? `, ${d.network.outages.length} outage${d.network.outages.length === 1 ? '' : 's'}` : ''}.${d.network.newDevices.length ? ` New devices: ${d.network.newDevices.length}.` : ''}`] });
  out.push({ h: `${out.length + 1}. Actions`, lines: actions.length ? actions : ['None outstanding.'] });
  return out;
}

// ---------------- PDF ----------------
const C = { ink: '#1b2430', muted: '#5b6672', line: '#c9d0d8', light: '#eef1f4', accent: '#3f6d93', amber: '#b07a12', red: '#b3261e', band: '#233329', bandText: '#e1ecdf' };
const SEV_C = { CRITICAL: C.red, HIGH: C.red, MEDIUM: C.amber, LOW: C.muted };

/** Build the PDF for a stored report: { ref, title, kind, from, to, generatedAt, generatedBy, sections, data, sitrep } */
export function reportPdf(rep) {
  const pdf = new Pdf({ title: `${rep.ref} ${rep.title}` });
  const M = 48, W = pdf.W - M * 2, TOP = 70, BOTTOM = pdf.H - 60;
  let y = TOP;
  const newPage = () => { pdf.addPage(); y = TOP; };
  const need = (h) => { if (y + h > BOTTOM) newPage(); };
  const h1 = (t) => { need(40); y += 8; pdf.text(M, y, t.toUpperCase(), { size: 10, font: 'F2', color: C.accent }); y += 6; pdf.line(M, y, M + W, y, { color: C.accent, width: 0.8 }); y += 14; };
  const para = (t, { size = 9.5, color = C.ink, font = 'F1', indent = 0 } = {}) => { for (const l of wrap(t, W - indent, size, font)) { need(size + 4); pdf.text(M + indent, y, l, { size, color, font }); y += size + 3.5; } };
  const table = (cols, rows, { size = 8.5 } = {}) => {
    const total = cols.reduce((s, c) => s + c.w, 0), k = W / total;
    const head = () => { need(22); pdf.rect(M, y - 10, W, 15, { fill: C.light }); let x = M; for (const c of cols) { pdf.text(x + 4, y, c.h.toUpperCase(), { size: 7, font: 'F2', color: C.muted }); x += c.w * k; } y += 12; };
    head();
    for (const r of rows) {
      const cells = cols.map((c, i) => wrap(String(r[i] ?? ''), c.w * k - 8, size, c.mono ? 'F3' : 'F1'));
      const h = Math.max(...cells.map((x) => x.length)) * (size + 3) + 4;
      if (y + h > BOTTOM) { newPage(); head(); }
      let x = M;
      cells.forEach((lines, i) => { lines.forEach((l, j) => pdf.text(x + 4, y + j * (size + 3), l, { size, font: cols[i].mono ? 'F3' : 'F1', color: cols[i].color?.(rows[rows.indexOf(r)]) || C.ink })); x += cols[i].w * k; });
      y += h; pdf.line(M, y - 9, M + W, y - 9, { color: C.light });
    }
    if (!rows.length) para('None.', { color: C.muted });
    y += 6;
  };
  const barChart = (title, items, { color = C.accent, height = 110, unit = '' } = {}) => {
    need(height + 40);
    pdf.text(M, y, title, { size: 8.5, font: 'F2', color: C.muted }); y += 8;
    const top = Math.max(1, ...items.map((i) => i.v)), bw = W / Math.max(1, items.length), base = y + height;
    pdf.line(M, base, M + W, base, { color: C.line });
    for (const q of top >= 4 ? [0.5, 1] : [1]) { const gy = base - q * height; pdf.line(M, gy, M + W, gy, { color: C.light }); pdf.text(M + W, gy - 2, `${Math.round(top * q)}${unit}`, { size: 6.5, color: C.muted, align: 'right' }); }
    const barW = Math.min(bw * 0.64, 56);
    items.forEach((it, i) => {
      const h = (it.v / top) * height, cx = M + i * bw + bw / 2, x = cx - barW / 2;
      if (h > 0) pdf.rect(x, base - h, barW, h, { fill: it.color || color });
      if (it.v) pdf.text(cx, base - h - 3, String(it.v), { size: 6.5, color: C.ink, align: 'center' });
      const lab = textWidth(it.label, 6.5) > bw - 2 ? it.label.slice(0, Math.max(3, Math.floor(bw / 4))) : it.label;
      pdf.text(cx, base + 9, lab, { size: 6.5, color: C.muted, align: 'center' });
    });
    y = base + 22;
  };
  const figures = (items) => {
    need(56);
    const w = W / items.length;
    items.forEach((it, i) => {
      const x = M + i * w;
      pdf.rect(x + 2, y, w - 4, 44, { stroke: C.line, width: 0.6 });
      pdf.text(x + 10, y + 13, it.label.toUpperCase(), { size: 6.5, font: 'F2', color: C.muted });
      pdf.text(x + 10, y + 34, String(it.value), { size: 17, font: 'F2', color: it.color || C.ink });
    });
    y += 56;
  };

  const d = rep.data, sec = new Set(rep.sections);
  // ---- cover block ----
  newPage();
  pdf.text(M, y, 'SENTINEL', { size: 9, font: 'F2', color: C.muted }); pdf.text(M + W, y, rep.ref, { size: 10, font: 'F3', color: C.ink, align: 'right' }); y += 26;
  pdf.text(M, y, rep.title, { size: 20, font: 'F2', color: C.ink }); y += 18;
  pdf.text(M, y, `Period: ${fmtDT(rep.from)} – ${fmtDT(rep.to)}`, { size: 9.5, color: C.muted }); y += 13;
  pdf.text(M, y, `Prepared ${fmtDate(rep.generatedAt)} by ${rep.generatedBy}`, { size: 9.5, color: C.muted }); y += 10;
  pdf.line(M, y, M + W, y, { color: C.ink, width: 1 }); y += 18;

  if (rep.sitrep) { h1('Situation report'); for (const s of rep.sitrep) { need(30); pdf.text(M, y, s.h, { size: 9.5, font: 'F2' }); y += 13; for (const l of s.lines.filter(Boolean)) para(l, { indent: 12 }); y += 4; } }
  if (sec.has('summary')) {
    h1('Summary');
    figures([{ label: 'Sensor events', value: d.totals.activity }, { label: 'Alerts', value: d.totals.alerts }, { label: 'High / critical', value: d.totals.critical, color: d.totals.critical ? C.red : C.ink }, { label: 'Incidents opened', value: d.totals.incidentsOpened }, { label: 'Internet uptime', value: d.network.uptime != null ? `${d.network.uptime}%` : '—' }]);
    para(`Average time from alert to first action: ${d.alerts.mttaText}. Unhandled at the end of the period: ${d.totals.unhandled}.`, { color: C.muted });
  }
  if (sec.has('activity')) {
    h1('Activity');
    barChart('Sensor events per day', d.days.map((x) => ({ label: x.label.split(' ').slice(0, 2).join(' '), v: x.activity })));
    if (d.rooms.length) barChart('Sensor events by room', d.rooms.slice(0, 12).map((r) => ({ label: r.name, v: r.count })));
  }
  if (sec.has('alerts')) {
    h1('Alerts and triage');
    barChart('Alerts by severity', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => ({ label: s, v: d.alerts.bySev[s], color: SEV_C[s] })), { height: 80 });
    const st = Object.entries(d.alerts.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ');
    if (st) para(`By outcome: ${st}.`, { color: C.muted });
    const dr = Object.entries(d.alerts.dismissReasons).map(([k, v]) => `${k} (${v})`).join(', ');
    if (dr) para(`Dismissed as: ${dr}.`, { color: C.muted });
    y += 4;
    table([{ h: 'Time', w: 70 }, { h: 'Ref', w: 62, mono: true }, { h: 'Severity', w: 52, color: (r) => SEV_C[r[2]] }, { h: 'Alert', w: 200 }, { h: 'Outcome', w: 70 }], d.alerts.notable.map((a) => [fmtDT(a.ts), a.id, a.severity, a.title, a.status]));
  }
  if (sec.has('incidents')) { h1('Incidents'); table([{ h: 'Reference', w: 85, mono: true }, { h: 'Title', w: 190 }, { h: 'Severity', w: 55, color: (r) => SEV_C[r[2]] }, { h: 'Status', w: 65 }, { h: 'Assignee', w: 60 }], d.incidents.map((i) => [i.ref, i.title, i.severity, i.status, i.assignee])); }
  if (sec.has('anomalies')) {
    h1('Anomalies and correlations');
    table([{ h: 'Time', w: 70 }, { h: 'Anomaly', w: 140 }, { h: 'Conf.', w: 36 }, { h: 'Why', w: 220 }], d.anomalies.map((a) => [fmtDT(a.ts), a.title, `${a.confidence}%`, a.reason]));
    if (d.correlations.length) table([{ h: 'Time', w: 70 }, { h: 'Correlation', w: 396 }], d.correlations.map((c) => [fmtDT(c.ts), c.text]));
  }
  if (sec.has('agents')) { h1('Agents'); table([{ h: 'Agent', w: 105 }, { h: 'Mission', w: 90 }, { h: 'Room', w: 80 }, { h: 'Uptime', w: 50 }, { h: 'Battery', w: 50 }, { h: 'Tamper', w: 45 }], d.agents.map((a) => [a.label, a.mission, a.room, a.uptime != null ? `${a.uptime}%` : '—', a.battery != null ? `${Math.round(a.battery * 100)}%` : '—', a.tampers || '—'])); }
  if (sec.has('network')) {
    h1('Network');
    para(`Internet uptime ${d.network.uptime != null ? `${d.network.uptime}%` : 'not recorded'} · ${d.network.outages.length} outage${d.network.outages.length === 1 ? '' : 's'} (total ${mins(d.network.downMs)}) · ${d.network.newDevices.length} new device${d.network.newDevices.length === 1 ? '' : 's'} seen.`);
    if (d.network.outages.length) table([{ h: 'Outage started', w: 150 }, { h: 'Ended', w: 150 }, { h: 'Length', w: 100 }], d.network.outages.map((o) => [fmtDT(o.from), o.to ? fmtDT(o.to) : 'ongoing', mins((o.to ?? rep.to) - o.from)]));
    if (d.network.newDevices.length) table([{ h: 'Time', w: 90 }, { h: 'New device', w: 376 }], d.network.newDevices.map((x) => [fmtDT(x.ts), x.text]));
  }
  if (sec.has('states')) { h1('Alert state changes'); table([{ h: 'Time', w: 90 }, { h: 'Change', w: 376 }], d.states.map((x) => [fmtDT(x.ts), x.text])); }
  if (sec.has('log')) { h1('Event log'); table([{ h: 'Time', w: 80 }, { h: 'Type', w: 55 }, { h: 'Event', w: 330 }], d.log.slice().reverse().map((e) => [fmtDT(e.ts), e.kind, e.text]), { size: 7.5 }); }

  // ---- banners and page numbers on every page ----
  const total = pdf.pages.length;
  pdf.pages.forEach((pg, i) => {
    pdf.cur = pg;
    for (const by of [0, pdf.H - 18]) { pdf.rect(0, by, pdf.W, 18, { fill: C.band }); pdf.text(pdf.W / 2, by + 12, CLASSIFICATION, { size: 7.5, font: 'F2', color: C.bandText, align: 'center' }); }
    pdf.line(M, pdf.H - 38, M + W, pdf.H - 38, { color: C.line });
    pdf.text(M, pdf.H - 27, `${rep.ref} · ${rep.title}`, { size: 7, color: C.muted });
    pdf.text(M + W, pdf.H - 27, `Page ${i + 1} of ${total}`, { size: 7, color: C.muted, align: 'right' });
  });
  return pdf.output();
}
