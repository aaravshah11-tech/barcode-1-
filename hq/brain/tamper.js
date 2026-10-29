// TAMPER DETECTION (HQ's side). The Agent itself reports "moved" and "camera covered"; HQ notices
// "unplugged", "battery draining fast" and "went offline unexpectedly". Each becomes a 'tamper'
// entry in the Mission Log and an alert in the Triage queue with a plain-English explanation.
import { agentLabel } from '../../shared/crypto.js';

const ARMED = new Set(['away', 'night', 'lockdown']);
export const TAMPER_TEXT = {
  moved: ['Agent moved', 'The phone was picked up or turned. Check it still points where it should.'],
  covered: ['Camera covered', 'The camera picture went completely dark and flat — the lens may be covered.'],
  unplugged: ['Agent unplugged', 'The phone stopped charging. Someone may have pulled the cable (or the plug was switched off).'],
  drain: ['Battery draining fast', 'The battery is dropping much faster than normal. The phone may be overheating or running something else.'],
  offline: ['Agent offline unexpectedly', 'HQ lost contact without the Agent being disconnected.'],
};

export class Tamper {
  constructor({ hq, db }) {
    this.hq = hq; this.db = db;
    this.drainFlag = new Map();
    hq.on('event', (ev) => { if (ev.kind === 'tamper' && ev.agentId && ev.data?.type && ev.data.type !== 'uncovered' && !ev.data.hq) this.raise(ev.agentId, ev.data.type, ev); });
    hq.on('agentStatus', (id, { prevCharging, status }) => this.status(id, prevCharging, status));
    hq.on('agentOffline', (a) => this.offline(a));
  }
  mode() { return this.hq.settings().mode; }
  /** HQ-detected tamper: write it in the log, then raise it. */
  log(agentId, type, extra = '') {
    const a = this.db.agent(agentId);
    if (!a) return null;
    const ev = this.hq.logEvent({ kind: 'tamper', agentId, level: 'warn', message: `${agentLabel(a)} ${a.codename}: ${TAMPER_TEXT[type][0]}${extra ? ` — ${extra}` : ''}`, data: { type, hq: true } });
    return this.raise(agentId, type, ev, extra);
  }
  raise(agentId, type, ev, extra = '') {
    const [title, why] = TAMPER_TEXT[type] || ['Tamper', ''];
    const armed = ARMED.has(this.mode());
    const severity = type === 'drain' ? 'LOW' : (type === 'covered' || type === 'offline' || type === 'unplugged') && armed ? 'HIGH' : 'MEDIUM';
    const { roomId, room } = this.hq.ops.roomOf(agentId);
    const a = this.db.agent(agentId);
    this.db.updateAgent(agentId, { lastTamper: { type, ts: ev?.ts || this.hq.now() } });
    return this.hq.ops.raise({ severity, title: `${title} — ${a?.codename || 'Agent'}${room ? ` (${room})` : ''}`, explanation: `${why}${extra ? ` ${extra}.` : ''}${armed ? ` The house is in ${this.mode().toUpperCase()}.` : ''}`, source: 'tamper', kind: `tamper:${type}`, agentId, roomId, room, eventIds: ev ? [ev.id] : [] });
  }
  status(id, prevCharging, st) {
    if (prevCharging === true && st.charging === false) this.log(id, 'unplugged', typeof st.battery === 'number' ? `battery ${Math.round(st.battery * 100)}%` : '');
    if (st.charging) { this.drainFlag.delete(id); return; }
    // fast drain: ≥ 10 points in the last hour while not charging (≈ 15 %/h or more)
    const samples = (this.hq.diagAll()[id] || []).filter((x) => x.b != null && x.t >= this.hq.now() - 3600000);
    let run = [];
    for (const x of samples) { if (x.c) run = []; else run.push(x); }
    if (run.length < 2 || this.drainFlag.get(id)) return;
    const used = run[0].b - run.at(-1).b, hrs = (run.at(-1).t - run[0].t) / 3600000;
    if (used >= 10 && hrs > 0.15 && used / hrs >= 15) { this.drainFlag.set(id, true); this.log(id, 'drain', `${Math.round(used / hrs)}% per hour`); }
  }
  offline(a) {
    const facts = [];
    if (typeof a.battery === 'number') facts.push(`battery was ${Math.round(a.battery * 100)}%${a.charging ? ' and charging' : ''}`);
    if (typeof a.battery === 'number' && a.battery > 0.15) facts.push('so it didn’t run flat — it may have been switched off, closed or taken off Wi-Fi');
    this.log(a.id, 'offline', facts.join(', '));
  }
}
