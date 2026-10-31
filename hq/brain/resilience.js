// DATA + RESILIENCE (HQ's side): retention rules, nightly encrypted backups that are test-restored,
// tamper-evident evidence export, and a record of when HQ wasn't running.
import { openStore } from './store.js';
import { verifyChain } from '../../shared/audit.js';
import { sealBackup, openBackup } from '../../shared/vault.js';
import { sha256 } from '../../shared/crypto.js';
import { canonical } from '../../shared/canonical.js';
import { CLASSIFICATION } from '../../shared/report.js';

const DAY = 86400000;
const fail = (status, message) => Object.assign(new Error(message), { status });
export const RETENTION_DEFAULTS = { events: 30, alerts: 90, incidents: 365, reports: 365, shift: 180, analysis: 90, audit: 730 };
export const RETENTION_LIMITS = { events: [1, 3650], alerts: [7, 3650], incidents: [30, 3650], reports: [7, 3650], shift: [7, 3650], analysis: [7, 3650], audit: [365, 3650] };
const BEAT = 'sentinel.hq.beat';

export class Resilience {
  constructor({ hq, db, storage = globalThis.localStorage }) { this.hq = hq; this.db = db; this.storage = storage; this.timers = []; }
  now() { return this.hq.now(); }
  start() {
    this.checkDowntime();
    this.timers.push(setInterval(() => this.beat(), 30000));
    this.timers.push(setInterval(() => this.nightly().catch((e) => console.warn(e)), 10 * 60000));
    this.beat();
    globalThis.addEventListener?.('pagehide', () => this.beat(true));
    setTimeout(() => this.nightly().catch(() => {}), 60000);
    return this;
  }
  stop() { this.timers.forEach(clearInterval); }

  // ---------- retention ----------
  retention() {
    const r = { ...RETENTION_DEFAULTS, ...(this.db.getSetting('retention', {}) || {}) };
    r.events = this.hq.settings().retentionDays; // the existing Mission Log setting
    return r;
  }
  setRetention(patch = {}) {
    const r = this.retention();
    for (const [k, [lo, hi]] of Object.entries(RETENTION_LIMITS)) if (k in patch) r[k] = Math.min(hi, Math.max(lo, Math.round(Number(patch[k]) || RETENTION_DEFAULTS[k])));
    const { events, ...rest } = r;
    this.db.setSetting('retention', rest);
    if (events !== this.hq.settings().retentionDays) this.hq.updateSettings({ retentionDays: events });
    return r;
  }
  /** Delete what is older than the retention rules. Open alerts and anything linked to an unclosed incident are kept. */
  prune() {
    const r = this.retention(), now = this.now(), old = (days) => now - days * DAY;
    const active = this.db.docs('incidents').filter((i) => i.status !== 'closed');
    const held = new Set(active.flatMap((i) => i.alertIds));
    const out = { events: this.db.pruneEvents(r.events * DAY, now) };
    out.alerts = this.db.removeDocs('alerts', (a) => a.ts < old(r.alerts) && !['new', 'acknowledged', 'escalated'].includes(a.status) && !held.has(a.id));
    out.incidents = this.db.removeDocs('incidents', (i) => i.status === 'closed' && (i.closedAt || i.updatedAt) < old(r.incidents));
    out.reports = this.db.removeDocs('reports', (x) => x.generatedAt < old(r.reports));
    out.shift = this.db.removeDocs('shift', (x) => x.ts < old(r.shift));
    out.analysis = this.db.removeDocs('anomalies', (x) => x.ts < old(r.analysis)) + this.db.removeDocs('matches', (x) => x.ts < old(r.analysis));
    out.audit = this.db.trimAudit(old(r.audit));
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    if (total) this.hq.logEvent({ kind: 'system', message: `Retention: removed ${Object.entries(out).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')}` });
    return out;
  }
  counts() {
    return { events: this.db.allEvents().length, alerts: this.db.docs('alerts').length, incidents: this.db.docs('incidents').length, reports: this.db.docs('reports').length, shift: this.db.docs('shift').length, analysis: this.db.docs('anomalies').length + this.db.docs('matches').length, audit: this.db.allAudit().length };
  }

  // ---------- backups ----------
  /** Open a backup in a throw-away in-memory HQ and check it is complete and its audit chain is intact. */
  async testRestore(backup) {
    try {
      const mem = await openStore({ memory: true });
      mem.restore(backup);
      const chain = verifyChain(mem.allAudit(), mem.auditAnchor());
      const counts = { events: mem.allEvents().length, alerts: mem.docs('alerts').length, incidents: mem.docs('incidents').length, audit: mem.allAudit().length, agents: mem.agents().length };
      const ok = chain.ok && counts.events === backup.events.length && counts.audit === (backup.audit || []).length;
      return { ok, at: this.now(), counts, detail: ok ? `Restored ${counts.events} events, ${counts.alerts} alerts, ${counts.incidents} incidents, ${counts.agents} Agents; audit chain intact.` : chain.ok ? 'Counts didn’t match after restoring.' : `Audit chain problem: ${chain.why}` };
    } catch (e) { return { ok: false, at: this.now(), detail: `Could not be restored: ${e.message}` }; }
  }
  async makeBackup(kind = 'manual', by = 'HQ') {
    const backup = { ...this.db.backup(), at: this.now() };
    const verified = await this.testRestore(backup);
    const text = JSON.stringify(backup);
    const info = { id: `bk-${this.now().toString(36)}`, at: this.now(), kind, by, size: text.length, sha256: sha256(text), counts: verified.counts || {}, verified };
    await this.db.putLocalBackup(info, backup);
    const list = await this.db.localBackups();
    for (const k of ['nightly', 'manual']) for (const old of list.filter((b) => b.kind === k).slice(k === 'nightly' ? 7 : 5)) await this.db.deleteLocalBackup(old.id);
    this.hq.logEvent({ kind: 'system', level: verified.ok ? 'info' : 'warn', message: `${kind === 'nightly' ? 'Nightly' : 'Manual'} backup made (encrypted) and test-restored: ${verified.ok ? 'OK' : 'FAILED'}` });
    if (!verified.ok) this.hq.ops.raise({ severity: 'MEDIUM', title: 'Backup failed its test restore', explanation: verified.detail, source: 'system', kind: 'backup' });
    this.db.setSetting('lastBackup', { at: info.at, ok: verified.ok });
    return info;
  }
  async nightly() {
    const now = this.now(), d = new Date(now);
    const last = this.db.getSetting('lastBackup', null);
    // once a day, after 03:00 (or as soon as HQ is open after that)
    const today3 = new Date(d).setHours(3, 0, 0, 0);
    if (now < today3 || (last && last.at >= today3)) return null;
    this.prune();
    return this.makeBackup('nightly', 'SENTINEL (automatic)');
  }
  backups() { return this.db.localBackups(); }
  async verifyBackup(id) {
    const b = await this.db.localBackup(id);
    if (!b) throw fail(404, 'No such backup.');
    const verified = await this.testRestore(b);
    const list = await this.db.localBackups(), info = list.find((x) => x.id === id);
    await this.db.putLocalBackup({ ...info, verified }, b);
    return verified;
  }
  async restoreLocal(id, by) {
    const b = await this.db.localBackup(id);
    if (!b) throw fail(404, 'No such backup.');
    await this.restore(b, by, `local backup of ${new Date(b.at).toLocaleString('en-GB')}`);
    return { ok: true };
  }
  async restore(b, by, what) {
    const before = this.db.lastAudit();
    this.db.restore(b);
    // the restore itself goes on the (restored) audit trail, so it can't happen silently
    this.hq.audit.add({ who: by, role: 'DIRECTOR', via: 'HQ computer', action: 'Backup restored', target: what, detail: before ? `replaced a trail ending at #${before.seq}` : '', ok: true });
    await this.db.flush();
    this.hq.broadcast({ t: 'reload', reason: 'HQ was restored from a backup.' });
  }
  async downloadEncrypted(password) {
    const backup = { ...this.db.backup(), at: this.now() };
    const text = await sealBackup(backup, password, { hqId: this.hq.info.hqId || null });
    return { filename: `sentinel-backup-${new Date(this.now()).toISOString().slice(0, 10)}.sentinel-backup`, type: 'application/json', text, sha256: sha256(text) };
  }
  async restoreFile(text, password, by) {
    const b = await openBackup(text, password);
    const verified = await this.testRestore(b);
    if (!verified.ok) throw fail(400, `That backup didn’t pass its test restore: ${verified.detail}`);
    await this.restore(b, by, `backup file of ${new Date(b.at).toLocaleString('en-GB')}`);
    return { ok: true, verified };
  }

  // ---------- evidence ----------
  /** A self-checking evidence package for an incident: everything about it, plus a SHA-256 fingerprint. */
  evidence(id, by) {
    const d = this.hq.ops.incidentDetail(id);
    const inc = d.incident, ids = new Set([inc.ref, inc.id, ...inc.alertIds]);
    const from = d.window.from - 10 * 60000, to = d.window.to + 10 * 60000;
    const content = {
      format: 'sentinel-evidence', version: 1, classification: CLASSIFICATION,
      ref: inc.ref, exportedAt: this.now(), exportedBy: by, hq: this.hq.info.hqId || null,
      incident: inc, alerts: d.alerts, timeline: d.timeline,
      events: this.db.events({ since: from, limit: 20000 }).filter((e) => e.ts <= to).reverse(),
      audit: this.db.allAudit().filter((a) => ids.has(a.target) || [...ids].some((x) => a.detail.includes(x))),
      auditChain: this.hq.audit.verify(), auditHead: this.db.lastAudit()?.hash || null,
    };
    const hash = sha256(canonical(content));
    this.hq.audit.add({ who: by, role: 'DIRECTOR', via: 'HQ computer', action: 'Evidence exported', target: inc.ref, detail: `sha256 ${hash}`, ok: true });
    this.hq.logEvent({ kind: 'system', message: `Evidence package for ${inc.ref} exported by ${by}` });
    const text = JSON.stringify({ content, sha256: hash }, null, 1);
    return { filename: `${inc.ref}-evidence.json`, type: 'application/json', text, sha256: hash };
  }
  /** Check an evidence file: is it unchanged, and does HQ's audit trail remember exporting it? */
  verifyEvidence(text) {
    let f;
    try { f = JSON.parse(text); } catch { throw fail(400, 'That isn’t a SENTINEL evidence file.'); }
    if (f?.content?.format !== 'sentinel-evidence' || !f.sha256) throw fail(400, 'That isn’t a SENTINEL evidence file.');
    const hash = sha256(canonical(f.content));
    const intact = hash === f.sha256;
    const rec = this.db.allAudit().find((a) => a.action === 'Evidence exported' && a.detail === `sha256 ${f.sha256}`);
    return { intact, ref: f.content.ref, exportedAt: f.content.exportedAt, exportedBy: f.content.exportedBy, recorded: rec ? { seq: rec.seq, ts: rec.ts, who: rec.who } : null, computed: hash, claimed: f.sha256 };
  }

  // ---------- when HQ wasn't running ----------
  beat(clean = false) { try { this.storage?.setItem(BEAT, JSON.stringify({ ts: this.now(), clean })); } catch { /* ignore */ } this.lastBeat = this.now(); }
  checkDowntime() {
    let prev = null;
    try { prev = JSON.parse(this.storage?.getItem(BEAT) || 'null'); } catch { /* ignore */ }
    if (!prev?.ts) return null;
    const gap = this.now() - prev.ts;
    if (gap < 3 * 60000) return null;
    return this.recordDowntime(prev.ts, this.now(), prev.clean ? 'closed' : 'stopped unexpectedly');
  }
  recordDowntime(from, to, why) {
    const rec = { id: `dt-${from.toString(36)}`, from, to, why };
    this.db.putDoc('downtime', rec, 500);
    const mins = Math.round((to - from) / 60000);
    const len = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
    const ev = this.hq.logEvent({ kind: 'system', level: why === 'closed' ? 'info' : 'warn', message: `HQ was not running for ${len} (${why})` });
    if (why !== 'closed') this.hq.ops.raise({ severity: why === 'hung' ? 'MEDIUM' : 'LOW', title: `HQ was down for ${len}`, explanation: `HQ ${why === 'asleep' ? 'was asleep (the computer slept)' : why === 'hung' ? 'stopped responding and was restarted by its watchdog' : 'stopped without being closed (crash, power cut or the browser was killed)'}. Agents couldn’t report during that time.`, source: 'system', kind: 'hq-down', eventIds: [ev.id] });
    return rec;
  }
  /** Reports from the page's watchdog (sleep, a hang, an automatic reload). */
  watchdog({ kind, ms = 0 } = {}) {
    const to = this.now(), from = to - Math.max(0, Number(ms) || 0);
    if (kind === 'sleep' && ms > 3 * 60000) return this.recordDowntime(from, to, 'asleep');
    if (kind === 'hang' && ms > 20000) return this.recordDowntime(from, to, 'hung');
    if (kind === 'reload') { this.hq.logEvent({ kind: 'system', level: 'warn', message: 'Watchdog restarted HQ (it had stopped responding or lost its link)' }); return { ok: true }; }
    return null;
  }
  downtime() { return this.db.docs('downtime').sort((a, b) => b.from - a.from).slice(0, 50); }
}
