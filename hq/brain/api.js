// HQ's "API": every action the Command Centre can take, in one place. The dashboard on the HQ
// computer calls it directly; linked phones call it over their encrypted link.
import { toCsv } from '../../shared/export.js';
import { missionById, MISSIONS } from '../../shared/missions.js';
import { coverage } from '../../shared/coverage.js';
import { hardwareFromUA, uptimePct } from '../../shared/register.js';
import { denied } from '../../shared/roles.js';
import { describe } from './auditlog.js';
import { sha256 } from '../../shared/crypto.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

export function makeApi({ hq, db, auth }) {
  /**
   * method, path (e.g. '/agents/abc'), body.
   * `who.remote` = a linked phone: it must log in with codename + PIN first (`who.session`),
   * and can't make backups/restores or set up the Director.
   */
  /** What isn't worth an audit entry: ordinary reading, and very frequent small updates. */
  const quiet = (m, p, url, body) => (m === 'GET' ? !/^\/(export|backup|audit|audit\/export)$/.test(p) : p === '/auth/status' || (p === '/house' && !url.searchParams.get('final')) || (/\/live$/.test(p) && body?.renew));
  function record(m, path, body, who, actor, ok, out) {
    const url = new URL(path, 'https://hq'), p = url.pathname;
    if (quiet(m, p, url, body) || !hq.audit) return;
    const d = describe(m, p, body, ok ? out : null);
    const via = who.remote ? `Phone “${who.label || 'linked phone'}”` : 'HQ computer';
    const name = actor.who || (p === '/auth/unlock' ? d.target || '?' : who.remote ? who.label || 'linked phone' : 'HQ');
    hq.audit.add({ who: name, role: actor.role || '', via, action: d.action, target: d.target, detail: ok ? d.detail : `${d.detail ? `${d.detail} — ` : ''}refused: ${out?.message || 'error'}`, ok });
  }
  async function api(method, path, body = {}, who = {}) {
    const actor = {};
    body ||= {};
    try { const r = await handle(method, path, body, who, actor); record(method.toUpperCase(), path, body, who, actor, true, r); return r; }
    catch (e) { record(method.toUpperCase(), path, body, who, actor, false, e); throw e; }
  }
  return api;

  async function handle(method, path, body, who, actor) {
    const url = new URL(path, 'https://hq');
    const p = url.pathname, m = method.toUpperCase();

    // ----- login -----
    if (p === '/auth/status' && m === 'GET') return auth.status();
    if (p === '/auth/setup' && m === 'POST') { if (who.remote) throw fail(403, 'Set up the Director on the HQ computer.'); const r = await auth.setup(body); hq.logEvent({ kind: 'system', message: `Director ${r.codename} enrolled` }); return r; }
    if (p === '/auth/unlock' && m === 'POST') {
      try {
        const r = await auth.unlock(body, who.remote ? `Phone “${who.label || 'linked phone'}”` : 'HQ computer');
        if (!who.remote) { hq.localOperator = r.codename; hq.localRole = r.role; hq.localSession = r.session; }
        actor.who = r.codename; actor.role = r.role;
        hq.logEvent({ kind: 'system', message: `${r.codename} (${r.role}) signed in${who.remote ? ' from a linked phone' : ''}` });
        return r;
      } catch (e) { if ((e.status === 401 && !e.needOtp) || e.status === 429) hq.logEvent({ kind: 'system', level: 'warn', message: `Failed login attempt${who.remote ? ' from a linked phone' : ''}` }); throw e; }
    }
    if (p === '/auth/lock' && m === 'POST') {
      const s = auth.session(who.remote ? who.session : hq.localSession);
      actor.who = s?.codename || (who.remote ? who.label || 'linked phone' : hq.localOperator); actor.role = s?.role || (who.remote ? null : hq.localRole);
      auth.lock(who.session || body.session || (!who.remote ? hq.localSession : null));
      if (!who.remote) { hq.localRole = null; hq.localSession = null; }
      return { ok: true };
    }
    if (who.remote && !auth.valid(who.session)) throw fail(401, 'Locked — log in with your codename and PIN.');
    if (!who.remote && hq.localSession && !auth.valid(hq.localSession)) { hq.localRole = null; hq.localSession = null; }

    // ----- who is asking, and may they? (checked here for every request) -----
    const sess = who.remote ? auth.session(who.session) : null;
    const role = who.remote ? sess?.role : hq.localRole;
    const by = who.remote ? (sess?.codename || who.label || 'a linked phone') : (hq.localOperator || 'HQ');
    actor.who = role ? by : null; actor.role = role || null;
    if (!role) { if (who.remote || m !== 'GET' || denied('OBSERVER', m, p)) throw fail(401, 'Locked — sign in first.'); }
    else { const why = denied(role, m, p, body); if (why) throw fail(403, why); }

    if (p === '/me' && m === 'GET') return { username: by, role, twoFactor: !!auth.users().find((u) => u.username === by)?.twoFactor };
    if (p === '/auth/change' && m === 'POST') return auth.change({ ...body, codename: by });

    // ----- users, sessions, two-step sign-in (Director only, except your own 2FA) -----
    if (p === '/users' && m === 'GET') return auth.users();
    if (p === '/users' && m === 'POST') { const u = await auth.addUser(body, by); hq.logEvent({ kind: 'system', message: `User ${u.username} (${u.role}) added by ${by}` }); return u; }
    let um = p.match(/^\/users\/([\w%-]{1,64})$/);
    if (um && m === 'PATCH') { const u = auth.updateUser(decodeURIComponent(um[1]), body); hq.logEvent({ kind: 'system', message: `User ${u.username}: ${u.disabled ? 'disabled' : u.role} (by ${by})` }); return u; }
    if (um && m === 'DELETE') { const r = auth.removeUser(decodeURIComponent(um[1])); hq.logEvent({ kind: 'system', message: `User ${decodeURIComponent(um[1]).toUpperCase()} removed by ${by}` }); return r; }
    if (p === '/auth/sessions' && m === 'GET') return auth.sessions(who.remote ? who.session : hq.localSession);
    if (p === '/auth/sessions' && m === 'DELETE') return auth.endAll(who.remote ? who.session : hq.localSession);
    um = p.match(/^\/auth\/sessions\/([\w-]{1,32})$/);
    if (um && m === 'DELETE') return auth.endSession(um[1]);
    if (p === '/auth/totp/begin' && m === 'POST') return auth.totpBegin(by, body.pin);
    if (p === '/auth/totp/enable' && m === 'POST') { const r = await auth.totpEnable(by, body.code); hq.logEvent({ kind: 'system', message: `Two-step sign-in turned on for ${by}` }); return r; }
    if (p === '/auth/totp/disable' && m === 'POST') { const r = await auth.totpDisable(by, body.pin); hq.logEvent({ kind: 'system', level: 'warn', message: `Two-step sign-in turned off for ${by}` }); return r; }

    // ----- audit trail (Director only; it can be read and exported, never edited) -----
    if (p === '/audit' && m === 'GET') return { entries: hq.audit.list({ limit: Math.min(2000, Number(url.searchParams.get('limit')) || 300), before: Number(url.searchParams.get('before')) || null }), verify: hq.audit.verify() };
    if (p === '/audit/export' && m === 'GET') {
      const rows = hq.audit.all(), v = hq.audit.verify();
      const csvq = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
      const text = ['seq,time,user,role,via,action,target,detail,ok,prev,hash', ...rows.map((e) => [e.seq, new Date(e.ts).toISOString(), e.who, e.role, e.via, e.action, e.target, e.detail, e.ok, e.prev, e.hash].map(csvq).join(','))].join('\n');
      return { filename: `sentinel-audit-${new Date(hq.now()).toISOString().slice(0, 10)}.csv`, type: 'text/csv', text, sha256: sha256(text), verify: v };
    }

    // ----- shift log + handover notes -----
    if (p === '/shift' && m === 'GET') return db.docs('shift').sort((a, b) => b.ts - a.ts).slice(0, 200);
    if (p === '/shift' && m === 'POST') {
      const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 2000);
      if (!text) throw fail(400, 'Write something first.');
      const snap = hq.snapshot();
      const entry = { id: `sh-${hq.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: hq.now(), by, role, text, handover: !!body.handover, acks: [],
        summary: body.handover ? { state: snap.settings.mode.toUpperCase(), unhandled: hq.ops.unhandled(), incidents: hq.ops.incidents().filter((i) => i.status === 'open' || i.status === 'investigating').map((i) => i.ref), offline: snap.agents.filter((a) => !a.online).map((a) => a.codename) } : null };
      db.putDoc('shift', entry, 1000);
      hq.logEvent({ kind: 'system', message: `${entry.handover ? 'Handover note' : 'Shift log entry'} by ${by}` });
      hq.broadcast({ t: 'shift' });
      return entry;
    }
    um = p.match(/^\/shift\/([\w-]{1,40})\/ack$/);
    if (um && m === 'POST') {
      const e = db.doc('shift', um[1]);
      if (!e) throw fail(404, 'No such entry.');
      if (!e.acks.some((a) => a.by === by)) e.acks.push({ by, ts: hq.now() });
      db.putDoc('shift', e, 1000);
      hq.broadcast({ t: 'shift' });
      return e;
    }

    if (p === '/state' && m === 'GET') return hq.snapshot();

    // ----- triage queue + incidents -----
    const ops = hq.ops;
    if (p === '/alerts' && m === 'GET') return ops.alerts({ status: url.searchParams.get('status') || null, limit: Math.min(3000, Number(url.searchParams.get('limit')) || 300) });
    let am = p.match(/^\/alerts\/(ALT-\d{6})\/(acknowledge|escalate|dismiss|reopen)$/);
    if (am && m === 'POST') return ops.act(am[1], am[2], { by, reason: body.reason, note: body.note });
    if (p === '/alerts/bulk' && m === 'POST') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 200).map(String);
      if (!['acknowledge', 'dismiss'].includes(body.action)) throw fail(400, 'Bulk actions: acknowledge or dismiss.');
      const done = [];
      for (const id of ids) { try { done.push(ops.act(id, body.action, { by, reason: body.reason })); } catch { /* already handled */ } }
      return { done: done.length };
    }
    // ----- reports -----
    if (p === '/sitrep' && m === 'GET') return hq.reports.liveSitrep();
    if (p === '/reports' && m === 'GET') return hq.reports.list();
    if (p === '/reports' && m === 'POST') return hq.reports.generate({ kind: ['sitrep', 'weekly', 'custom'].includes(body.kind) ? body.kind : 'custom', from: body.from, to: body.to, title: body.title, sections: body.sections, filter: body.filter, by });
    am = p.match(/^\/reports\/([\w-]{1,64})$/);
    if (am && m === 'GET') return hq.reports.get(am[1]);
    if (am && m === 'DELETE') return hq.reports.remove(am[1]);

    // ----- network security -----
    const ns = hq.net;
    if (p === '/network/assets' && m === 'GET') return ns.assets();
    if (p === '/network/assets' && m === 'POST') return ns.saveAsset({ ...body, id: null }, by);
    am = p.match(/^\/network\/assets\/([\w-]{1,64})$/);
    if (am && m === 'PUT') return ns.saveAsset({ ...body, id: am[1] }, by);
    if (am && m === 'DELETE') return ns.deleteAsset(am[1], by);
    if (p === '/network/import' && m === 'POST') return ns.importList(String(body.text || '').slice(0, 200000), by);
    if (p === '/network/health' && m === 'GET') return ns.health();
    if (p === '/network/checks' && m === 'PUT') return ns.setAnswers(body.answers);
    if (p === '/network/history' && m === 'GET') return ns.history();

    // ----- analysis: correlation rules + pattern of life -----
    const an = hq.analytics;
    if (p === '/rules' && m === 'GET') return { rules: an.rules(), matches: an.matches() };
    if (p === '/rules/test' && m === 'POST') return an.testRule(body, Math.min(30, Math.max(1, Number(body.days) || 7)));
    am = p.match(/^\/rules\/([\w-]{1,64})$/);
    if (am && m === 'PUT') return an.saveRule({ ...body, id: am[1] });
    if (am && m === 'DELETE') return an.deleteRule(am[1]);
    if (p === '/patterns' && m === 'GET') return an.patterns();
    if (p === '/patterns/rebuild' && m === 'POST') { an.rebuild(); return an.patterns(); }
    if (p === '/incidents' && m === 'GET') return ops.incidents();
    if (p === '/incidents' && m === 'POST') return ops.createIncident({ title: body.title, severity: body.severity, alertIds: (Array.isArray(body.alertIds) ? body.alertIds : []).slice(0, 100).map(String), assignee: body.assignee, note: body.note, by });
    am = p.match(/^\/incidents\/([\w-]{1,64})$/);
    if (am && m === 'GET') return ops.incidentDetail(am[1]);
    if (am && m === 'PATCH') return ops.updateIncident(am[1], body, { by });
    am = p.match(/^\/incidents\/([\w-]{1,64})\/notes$/);
    if (am && m === 'POST') return ops.addNote(am[1], body.text, { by });
    am = p.match(/^\/incidents\/([\w-]{1,64})\/alerts$/);
    if (am && m === 'POST') return ops.linkAlerts(am[1], (Array.isArray(body.alertIds) ? body.alertIds : []).slice(0, 100).map(String), { by });
    if (p === '/settings' && m === 'PATCH') return hq.updateSettings('mode' in body ? { ...body, by } : body);
    if (p === '/house' && m === 'GET') return hq.house();
    if (p === '/net/speedtest' && m === 'POST') { if (!hq.netmon) throw fail(409, 'Speed tests run on the HQ computer.'); return hq.netmon.speedTest(); }
    if (p === '/comms' && m === 'POST') {
      const r = hq.sendMessage({ target: String(body.target || 'all'), text: body.text, speak: body.speak, from: who.remote ? (who.label || 'a linked phone') : 'HQ' });
      if (!r) throw fail(400, 'Type a message, and pick an Agent (or a room with Agents in it).');
      return r;
    }
    if (p === '/panic' && m === 'POST') return hq.panic(who.remote ? (who.label || 'a linked phone') : 'HQ');
    if (p === '/alarm/stop' && m === 'POST') { hq.standDown(); return { ok: true }; }
    if (p === '/alarm/test' && m === 'POST') return { agents: hq.alarm({ reason: 'ALARM TEST', seconds: 4, force: true }) };
    if (p === '/house' && m === 'PUT') {
      const after = hq.saveHouse(body);
      const count = (h) => h.floors.reduce((n, f) => n + f.rooms.length, 0);
      // Logged once, when the builder is closed — not on every little edit.
      if (url.searchParams.get('final')) hq.logEvent({ kind: 'system', message: `House plan updated: ${after.floors.length} floor${after.floors.length === 1 ? '' : 's'}, ${count(after)} room${count(after) === 1 ? '' : 's'}` });
      return after;
    }
    if (p === '/log' && m === 'GET') {
      const before = Number(url.searchParams.get('before')) || null, since = Number(url.searchParams.get('since')) || null;
      // a period (since …) can be long — replay and heatmap read a whole day or week
      return db.events({ before, since, limit: Math.min(since ? 20000 : 500, Number(url.searchParams.get('limit')) || 100), kind: url.searchParams.get('kind') || null });
    }
    if (p === '/pair' && m === 'POST') {
      const role = body.role === 'viewer' ? 'viewer' : 'agent';
      return hq.newPairCode(role);
    }
    let mm = p.match(/^\/agents\/([\w-]{1,64})$/);
    if (mm) {
      if (m === 'PATCH') {
        if (body.mission && !missionById(body.mission)) throw fail(400, 'Unknown mission.');
        const a = hq.updateAgent(mm[1], body);
        if (!a) throw fail(404, 'No such Agent.');
        return a;
      }
      if (m === 'DELETE') { if (!hq.removeAgent(mm[1])) throw fail(404, 'No such Agent.'); return { ok: true }; }
    }
    mm = p.match(/^\/agents\/([\w-]{1,64})\/command$/);
    if (mm && m === 'POST') {
      if (!['find', 'reload', 'wake'].includes(body.action)) throw fail(400, 'Unknown command.');
      if (!hq.command(mm[1], body.action)) throw fail(409, 'That Agent is offline.');
      return { ok: true };
    }
    mm = p.match(/^\/agents\/([\w-]{1,64})\/place$/);
    if (mm && m === 'PUT') {
      const a = hq.placeAgent(mm[1], body.clear ? null : body);
      if (!a) throw fail(400, 'Couldn’t place the Agent there.');
      return a;
    }
    mm = p.match(/^\/agents\/([\w-]{1,64})\/live$/);
    if (mm && m === 'POST') {
      if (!hq.db.agent(mm[1])) throw fail(404, 'No such Agent.');
      if (!hq.command(mm[1], 'live', { on: !!body.on })) throw fail(409, 'That Agent is offline.');
      if (body.on && !body.renew) { const a = hq.db.agent(mm[1]); hq.logEvent({ kind: 'agent', agentId: a.id, message: `Live view opened on ${a.codename}` }); }
      return { ok: true };
    }
    mm = p.match(/^\/agents\/([\w-]{1,64})\/facing$/);
    if (mm && m === 'PUT') { const a = hq.setFacing(mm[1], body.dir); if (!a) throw fail(400, 'Place the Agent on the floor plan first.'); return a; }
    if (p === '/coverage' && m === 'GET') return coverage(hq.house(), hq.snapshot().agents);
    if (p === '/register' && m === 'GET') {
      const now = hq.now(), week = now - 7 * 86400000, events = db.events({ since: now - 30 * 86400000, limit: 50000, kind: null });
      return hq.snapshot().agents.map((a) => {
        const mlog = a.missionLog || [{ mission: a.mission, at: a.recruitedAt || a.createdAt || null }];
        return {
          id: a.id, label: a.label, codename: a.codename, name: a.name, mission: a.mission, missionName: missionById(a.mission)?.name || a.mission, online: a.online,
          hardware: hardwareFromUA(a.ua), recruitedAt: a.recruitedAt || a.createdAt || null, lastSeen: a.lastSeen, battery: a.battery, charging: a.charging,
          uptime7d: uptimePct(events, a.id, week, now, a.online), uptime30d: uptimePct(events, a.id, now - 30 * 86400000, now, a.online),
          calibratedAt: a.calibratedAt || null, notes: a.notes || '', lastTamper: a.lastTamper || null, place: a.place || null,
          missionLog: mlog.map((x) => ({ ...x, name: MISSIONS.find((mi) => mi.id === x.mission)?.name || x.mission })),
          tampers: events.filter((e) => e.agentId === a.id && e.kind === 'tamper').slice(0, 10),
        };
      });
    }
    mm = p.match(/^\/agents\/([\w-]{1,64})\/diag$/);
    if (mm && m === 'GET') { const d = hq.agentDiag(mm[1]); if (!d) throw fail(404, 'No such Agent.'); return d; }
    if (p === '/briefing' && m === 'GET') return hq.briefing(Math.min(30, Math.max(0, Math.round(Number(url.searchParams.get('daysAgo') ?? 1)) || 0)));
    if (p === '/weather/refresh' && m === 'POST') { if (!hq.refreshWeather) throw fail(409, 'Weather is fetched by the HQ computer.'); return hq.refreshWeather(); }
    if (p === '/viewers' && m === 'GET') return hq.viewers();
    mm = p.match(/^\/viewers\/([\w-]{1,64})$/);
    if (mm && m === 'DELETE') { if (!hq.removeViewer(mm[1])) throw fail(404, 'No such phone.'); return { ok: true }; }
    if (p === '/export' && m === 'GET') {
      const agents = new Map(db.agents().map((a) => [a.id, a]));
      const events = db.allEvents();
      const day = new Date().toISOString().slice(0, 10);
      return url.searchParams.get('format') === 'json'
        ? { filename: `sentinel-mission-log-${day}.json`, type: 'application/json', text: JSON.stringify({ exportedAt: new Date().toISOString(), agents: [...agents.values()].map(({ tokenHash, ...a }) => a), events }, null, 2) }
        : { filename: `sentinel-mission-log-${day}.csv`, type: 'text/csv', text: toCsv(events, agents) };
    }
    if (p === '/backup' && m === 'GET') {
      if (who.remote) throw fail(403, 'Backups can only be made on the HQ computer.');
      return { filename: `sentinel-hq-backup-${new Date().toISOString().slice(0, 10)}.json`, type: 'application/json', text: JSON.stringify(db.backup()) };
    }
    if (p === '/restore' && m === 'POST') {
      if (who.remote) throw fail(403, 'Restore on the HQ computer itself.');
      db.restore(body);
      return { ok: true };
    }
    throw fail(404, 'Not found');
  }
}
