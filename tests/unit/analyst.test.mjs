import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, parseProposal, parseSearch, describeSearch, autoPicture, refsIn } from '../../shared/analyst.js';
import { localUrl } from '../../hq/brain/analyst.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

test('citations are checked; PROPOSE lines become buttons, never actions', () => {
  const known = (r) => ['ALT-000412', 'EVT-77'].includes(r);
  const c = checkAnswer('A person was seen in the garden at 23:41 [EVT-77]. It was graded Alert [ALT-000412]. A van also called [EVT-999].\nPROPOSE: mode night\nPROPOSE: acknowledge ALT-000412\nPROPOSE: acknowledge ALT-999999\nPROPOSE: delete everything', known);
  assert.deepEqual(c.refs, ['EVT-77', 'ALT-000412']);
  assert.deepEqual(c.unknown, ['EVT-999']);
  assert.deepEqual(c.proposals.map((p) => p.label), ['Switch to NIGHT', 'Acknowledge ALT-000412'], 'unknown alerts and unknown actions are dropped');
  assert.ok(!/PROPOSE/.test(c.text));
  assert.equal(parseProposal('open-incident alt-000001').action, 'incident');
  assert.deepEqual(refsIn('see INC-2026-0004 and INC-2026-0004'), ['INC-2026-0004']);
});

test('plain-English search', () => {
  const now = at(3, 9);
  const f = parseSearch('anyone in the garden last night', now);
  assert.deepEqual([f.kind, f.class, f.zone], ['perimeter', 'person', 'garden']);
  assert.equal(new Date(f.from).getHours(), 20);
  assert.equal(new Date(f.to).getHours(), 7);
  assert.equal(new Date(f.to).getDate(), 3);
  assert.equal(parseSearch('door events in the last 3 hours', now).hours, 3);
  assert.equal(parseSearch('motion in the kitchen yesterday', now).text, 'kitchen');
  assert.equal(parseSearch('cars at the front today', now).class, 'vehicle');
  assert.match(describeSearch(f), /^people in the garden, /);
});

test('automatic Current Picture cites its evidence', () => {
  const t = autoPicture({ mode: 'night', threat: { level: 'AMBER' }, alerts: [{ id: 'ALT-000003', ts: at(3, 1), severity: 'ALERT', status: 'new', title: 'Person — Garden' }],
    agents: [{ codename: 'OWL', online: false }], events: [{ id: 9, ts: at(3, 1), kind: 'perimeter', message: 'AGENT-01 OWL: Person detected (garden)' }], now: at(3, 2) });
  assert.match(t, /^Alert State NIGHT; threat AMBER\. 1 unhandled alert, the most serious being “Person — Garden” at 01:00 \[ALT-000003\]\. Last activity: Person detected \(garden\) at 01:00 \[EVT-9\]\. 1 Agent is offline: OWL\.$/);
});

test('the model must be local', () => {
  for (const u of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://192.168.1.20:11434', 'http://mac-mini.local:11434', 'http://[::1]:11434']) assert.ok(localUrl(u), u);
  for (const u of ['https://api.openai.com', 'http://8.8.8.8:11434', 'ftp://localhost', 'nonsense']) assert.ok(!localUrl(u), u);
});

test('HQ: the Analyst uses read-only tools, cites evidence, and falls back without a model', async () => {
  const { openStore } = await import('../../hq/brain/store.js');
  const { HQ } = await import('../../hq/brain/hq.js');
  const { makeApi } = await import('../../hq/brain/api.js');
  const { makeAuth } = await import('../../hq/brain/auth.js');
  const db = await openStore({ memory: true });
  const hq = new HQ({ db });
  hq.localRole = 'DIRECTOR';
  const api = (m, p, b) => makeApi({ hq, db, auth: makeAuth({ db }) })(m, p, b, { remote: false });
  await api('PATCH', '/settings', { mode: 'away' });
  hq.logEvent({ kind: 'motion', level: 'alert', message: 'Motion detected', data: { armed: 'away' } });
  const alert = hq.ops.alerts()[0];
  // no model: automatic answers, clearly marked
  let r = await api('POST', '/analyst/ask', { q: 'motion today' });
  assert.equal(r.auto, true);
  assert.match(r.text, /Searched for motion events, .*1 match/);
  await assert.rejects(api('PATCH', '/settings', { analyst: { url: 'https://api.example.com' } }), /home network/);
  // a fake Ollama: lists a model, asks for a tool, then answers citing the alert it was shown
  const calls = [];
  hq.analyst.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.1:8b' }] }) };
    const last = body.messages.at(-1);
    if (last.role === 'user') return { ok: true, json: async () => ({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_alerts', arguments: { hours: 6 } } }, { function: { name: 'set_mode', arguments: { mode: 'home' } } }] } }) };
    return { ok: true, json: async () => ({ message: { role: 'assistant', content: `Motion was detected while the house was empty [${alert.id}]. Nothing else [ALT-999999].\nPROPOSE: open-incident ${alert.id}` } }) };
  };
  await api('PATCH', '/settings', { analyst: { on: true, url: 'http://localhost:11434' } });
  r = await api('POST', '/analyst/ask', { q: 'What happened?' });
  assert.equal(r.auto, false);
  assert.equal(r.model, 'llama3.1:8b');
  assert.deepEqual(r.refs, [alert.id]);
  assert.deepEqual(r.unknown, ['ALT-999999']);
  assert.match(r.text, /\[unverified\]/);
  assert.equal(r.proposals[0].action, 'incident');
  const chat = calls.find((c) => c.body?.tools);
  assert.deepEqual(chat.body.tools.map((t) => t.function.name), ['get_situation', 'get_alerts', 'search_log', 'get_incident', 'get_fleet', 'get_patterns'], 'only read-only tools are offered');
  const toolMsgs = calls.at(-1).body.messages.filter((m) => m.role === 'tool');
  assert.match(toolMsgs[1].content, /no tool called set_mode/, 'a made-up tool does nothing');
  assert.equal(db.getSetting('hq').mode, 'away', 'the Analyst changed nothing');
  const n = await api('POST', '/analyst/ask', { kind: 'picture' });
  assert.equal(n.kind, 'picture');
  assert.equal((await api('GET', '/analyst/notes?kind=picture')).length, 1);
  hq.stop();
});
