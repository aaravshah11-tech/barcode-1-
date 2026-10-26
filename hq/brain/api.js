// HQ's "API": every action the Command Centre can take, in one place. The dashboard on the HQ
// computer calls it directly; linked phones call it over their encrypted link.
import { toCsv } from '../../shared/export.js';
import { missionById } from '../../shared/missions.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

export function makeApi({ hq, db, auth }) {
  /**
   * method, path (e.g. '/agents/abc'), body.
   * `who.remote` = a linked phone: it must log in with codename + PIN first (`who.session`),
   * and can't make backups/restores or set up the Director.
   */
  return async function api(method, path, body = {}, who = {}) {
    const url = new URL(path, 'https://hq');
    const p = url.pathname, m = method.toUpperCase();
    body ||= {};

    // ----- login -----
    if (p === '/auth/status' && m === 'GET') return auth.status();
    if (p === '/auth/setup' && m === 'POST') { if (who.remote) throw fail(403, 'Set up the Director on the HQ computer.'); const r = await auth.setup(body); hq.logEvent({ kind: 'system', message: `Director ${r.codename} enrolled` }); return r; }
    if (p === '/auth/unlock' && m === 'POST') {
      try { const r = await auth.unlock(body); hq.logEvent({ kind: 'system', message: `${r.codename} logged in${who.remote ? ' from a linked phone' : ''}` }); return r; }
      catch (e) { if (e.status === 401 || e.status === 429) hq.logEvent({ kind: 'system', level: 'warn', message: `Failed login attempt${who.remote ? ' from a linked phone' : ''}` }); throw e; }
    }
    if (p === '/auth/lock' && m === 'POST') { auth.lock(who.session || body.session); return { ok: true }; }
    if (who.remote && !auth.valid(who.session)) throw fail(401, 'Locked — log in with your codename and PIN.');
    if (p === '/auth/change' && m === 'POST') return auth.change(body);

    if (p === '/state' && m === 'GET') return hq.snapshot();
    if (p === '/settings' && m === 'PATCH') return hq.updateSettings(body);
    if (p === '/log' && m === 'GET') {
      const before = Number(url.searchParams.get('before')) || null;
      return db.events({ before, limit: Math.min(500, Number(url.searchParams.get('limit')) || 100), kind: url.searchParams.get('kind') || null });
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
    mm = p.match(/^\/agents\/([\w-]{1,64})\/live$/);
    if (mm && m === 'POST') {
      if (!hq.db.agent(mm[1])) throw fail(404, 'No such Agent.');
      if (!hq.command(mm[1], 'live', { on: !!body.on })) throw fail(409, 'That Agent is offline.');
      if (body.on && !body.renew) { const a = hq.db.agent(mm[1]); hq.logEvent({ kind: 'agent', agentId: a.id, message: `Live view opened on ${a.codename}` }); }
      return { ok: true };
    }
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
  };
}
