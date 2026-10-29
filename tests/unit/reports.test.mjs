// Reports: figures, SITREP wording, reference numbers, and a valid PDF with banners on every page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pdf, textWidth, wrap, encodeText } from '../../shared/pdf.js';
import { reportPdf, isoWeek } from '../../shared/report.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';

const latin = (bytes) => Buffer.from(bytes).toString('latin1');

test('PDF writer: valid structure (cross-reference table points at every object)', () => {
  const p = new Pdf();
  p.addPage().text(50, 50, 'Hello – SENTINEL’s “report” · 12°').rect(50, 60, 100, 20, { fill: '#3f6d93' }).line(50, 90, 200, 90);
  p.addPage().text(50, 50, 'Page two');
  const s = latin(p.output());
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.ok(s.slice(xref).startsWith('xref'));
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
  assert.match(s, /\/Count 2/);
  assert.deepEqual(encodeText('–’·°→'), [0x96, 0x92, 0xb7, 0xb0, 45, 62]);
  assert.ok(Math.abs(textWidth('Hello', 10) - 22.78) < 0.01);
  assert.deepEqual(wrap('one two three four', textWidth('one two', 10), 10), ['one two', 'three', 'four']);
});

async function setup() {
  const clock = { t: new Date(2026, 9, 26, 9, 0).getTime() }; // Monday 26 Oct 2026
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  hq.localOperator = 'NIGHTOWL';
  const api = makeApi({ hq, db, auth: makeAuth({ db }) });
  const call = (m, p, b) => api(m, p, b, { remote: false });
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  hq.agentOnline(db.agent(agentId), { token, sendRaw() {}, close() {} });
  hq.updateAgent(agentId, { mission: 'motion', codename: 'wolf' });
  // last week: some activity every day, two alerts while AWAY
  for (let d = 7; d >= 1; d--) for (let i = 0; i < d; i++) db.addEvent({ ts: clock.t - d * 86400000 + i * 600000, kind: 'motion', agentId, message: 'AGENT-01 WOLF: Motion detected' });
  return { clock, db, hq, call, agentId };
}

test('reports: weekly RPT-YYYY-Wnn with figures; custom RPT-YYYY-NNNN; live SITREP with actions', async () => {
  const { clock, hq, call, agentId } = await setup();
  await call('PATCH', '/settings', { mode: 'away' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  const [al] = await call('GET', '/alerts');
  await call('POST', `/alerts/${al.id}/acknowledge`);
  const wk = await call('POST', '/reports', { kind: 'weekly' });
  assert.equal(wk.ref, `RPT-2026-W${String(isoWeek(clock.t - 3 * 86400000).week).padStart(2, '0')}`);
  assert.equal(wk.data.days.length, 7);
  assert.equal(wk.data.totals.activity, 28, '7+6+…+1 events last week');
  assert.equal(wk.data.alerts.bySev.HIGH, 0, 'today’s alert is not in last week');
  assert.ok(wk.sitrep.length >= 4);
  const c = await call('POST', '/reports', { kind: 'custom', from: clock.t - 86400000, to: clock.t + 1000, title: 'Today so far', sections: ['summary', 'alerts', 'log'] });
  assert.equal(c.ref, 'RPT-2026-0001');
  assert.equal(c.data.alerts.bySev.HIGH, 1);
  assert.ok(c.data.alerts.mtta != null, 'time to first action measured');
  assert.ok(c.data.log.length > 0);
  await assert.rejects(call('POST', '/reports', { kind: 'custom', from: 5, to: 1 }), /end after the start/);
  const list = await call('GET', '/reports');
  assert.equal(list.length, 2);
  assert.equal(list[0].data, undefined, 'the list is light (no data)');
  const live = await call('GET', '/sitrep');
  assert.match(live.ref, /^SITREP-20261026$/);
  assert.ok(live.sitrep.some((s) => s.h.endsWith('Actions')));
  assert.equal(live.sitrep[0].h, '1. Situation');
  assert.match(live.sitrep[0].lines[0], /Alert state AWAY/);
});

test('report PDF: banners top and bottom on every page, reference and page numbers, readable text', async () => {
  const { call, clock } = await setup();
  const rep = await call('POST', '/reports', { kind: 'custom', from: clock.t - 8 * 86400000, to: clock.t, title: 'Fortnight review', sections: ['summary', 'activity', 'alerts', 'incidents', 'agents', 'network', 'states', 'log'] });
  const bytes = reportPdf(rep);
  const dir = mkdtempSync(path.join(tmpdir(), 'rpt-'));
  const file = path.join(dir, 'r.pdf');
  writeFileSync(file, bytes);
  let text;
  try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }); } catch { return; } // tool not installed: structure is tested above
  const pages = text.split('\f').filter((p) => p.trim());
  assert.ok(pages.length >= 2, `${pages.length} pages`);
  for (const pg of pages) {
    assert.equal((pg.match(/SENTINEL \/\/ RESTRICTED – HOUSEHOLD/g) || []).length, 2, 'top and bottom banner');
    assert.match(pg, /RPT-2026-0001 · Fortnight review/);
    assert.match(pg, /Page \d+ of \d+/);
  }
  assert.match(text, /Fortnight review/);
  assert.match(text, /Sensor events per day/);
  assert.match(text, /AGENT-01 WOLF/);
});
