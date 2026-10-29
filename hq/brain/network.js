// NETWORK SECURITY (HQ's side): the asset register, alerts about new/untrusted devices and unusual
// behaviour, the health check and the internet history. Nothing here scans the network — devices
// come from SENTINEL itself, from you, or from a list you copy out of your own router.
import { cleanAsset, parseRouterList, mergeImport, healthCheck, ROUTER_CHECKS } from '../../shared/assets.js';
import { hardwareFromUA } from '../../shared/register.js';
import { history } from '../../shared/netstats.js';
import { agentLabel } from '../../shared/crypto.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

export class NetSecurity {
  constructor({ hq, db }) {
    this.hq = hq; this.db = db;
    hq.on('agentStatus', (id, info) => this.agentNet(id, info));
    hq.on('event', (ev) => { if (ev.kind === 'device' && ev.data?.type === 'phone') this.phoneSeen(ev); });
  }
  now() { return this.hq.now(); }

  /** The register, with SENTINEL's own devices kept up to date automatically. */
  assets() {
    const now = this.now(), list = this.db.docs('assets');
    const want = new Map();
    want.set('hq', { name: 'HQ computer', type: 'laptop', vendor: globalThis.navigator ? hardwareFromUA(navigator.userAgent).text : 'This computer', owner: this.hq.localOperator || '' });
    for (const a of this.db.agents()) want.set(`agent:${a.id}`, { name: `${agentLabel(a)} ${a.codename}${a.name ? ` (${a.name})` : ''}`, type: 'phone', vendor: hardwareFromUA(a.ua).text, lastSeen: a.lastSeen || now });
    for (const v of this.db.viewers()) want.set(`viewer:${v.id}`, { name: `Linked phone “${v.label}”`, type: 'phone', vendor: hardwareFromUA(v.ua || '').device === 'Unknown device' ? '' : hardwareFromUA(v.ua || '').text, lastSeen: v.lastSeen || now });
    let changed = false;
    for (const [ref, w] of want) {
      const cur = list.find((x) => x.ref === ref);
      if (!cur) { this.db.putDoc('assets', cleanAsset({ ...w, ref, source: 'sentinel', trusted: true, firstSeen: now, lastSeen: w.lastSeen || now }, now)); changed = true; }
      else if (cur.name !== w.name || (w.lastSeen && cur.lastSeen !== w.lastSeen)) { this.db.putDoc('assets', { ...cur, name: w.name, vendor: cur.vendor || w.vendor, lastSeen: w.lastSeen || cur.lastSeen }); changed = true; }
    }
    const gone = list.filter((x) => x.source === 'sentinel' && !want.has(x.ref));
    if (gone.length) { this.db.removeDocs('assets', (x) => gone.some((g) => g.id === x.id)); changed = true; }
    return (changed ? this.db.docs('assets') : list).sort((a, b) => (a.trusted - b.trusted) || b.lastSeen - a.lastSeen);
  }
  saveAsset(body, by = 'HQ') {
    const prev = body.id ? this.db.doc('assets', body.id) : null;
    if (prev?.source === 'sentinel') { // SENTINEL's own devices: only owner and notes can change
      const out = this.db.putDoc('assets', { ...prev, owner: cleanAsset(body).owner, notes: cleanAsset(body).notes });
      this.publish();
      return out;
    }
    const a = cleanAsset({ ...prev, ...body, source: prev?.source || 'manual', firstSeen: prev?.firstSeen, lastSeen: prev?.lastSeen }, this.now());
    if (a.mac && this.db.docs('assets').some((x) => x.mac === a.mac && x.id !== a.id)) throw fail(409, 'A device with that MAC address is already in the register.');
    this.db.putDoc('assets', a, 1000);
    if (!prev) this.hq.logEvent({ kind: 'network', message: `Device added to the register: ${a.name}${a.trusted ? ' (trusted)' : ''} by ${by}` });
    else if (prev.trusted !== a.trusted) this.hq.logEvent({ kind: 'network', message: `${a.name} marked ${a.trusted ? 'trusted' : 'untrusted'} by ${by}` });
    this.publish();
    return a;
  }
  deleteAsset(id, by = 'HQ') {
    const a = this.db.doc('assets', id);
    if (!a) throw fail(404, 'No such device.');
    if (a.source === 'sentinel') throw fail(409, 'SENTINEL’s own devices are listed automatically. Remove the Agent or phone instead.');
    this.db.removeDocs('assets', (x) => x.id === id);
    this.hq.logEvent({ kind: 'network', message: `Device removed from the register: ${a.name} (by ${by})` });
    this.publish();
    return { ok: true };
  }
  publish() { this.hq.broadcast({ t: 'assets' }); }

  /** A device list copied from your own router. */
  importList(text, by = 'HQ') {
    const rows = parseRouterList(text);
    if (!rows.length) throw fail(400, 'No devices found. Copy the “attached devices” table from your router’s admin page — each line needs a MAC address (like 3C:22:FB:12:34:56).');
    const before = this.assets().filter((a) => a.source !== 'sentinel');
    const { assets, added, seen } = mergeImport(before, rows, this.now());
    for (const a of assets) this.db.putDoc('assets', a, 1000);
    this.hq.logEvent({ kind: 'network', message: `Router device list imported by ${by}: ${rows.length} device${rows.length === 1 ? '' : 's'}, ${added.length} new` });
    for (const a of added) {
      const ev = this.hq.logEvent({ kind: 'device', level: 'warn', message: `New device on your network: ${a.name}${a.vendor ? ` (${a.vendor})` : ''}`, data: { device: a.name, owner: '', type: 'net', new: true } });
      this.hq.ops.raise({ severity: 'MEDIUM', title: `New device on your network — ${a.name}`, explanation: `${a.vendor ? `Made by ${a.vendor}. ` : ''}MAC ${a.mac}${a.ip ? `, IP ${a.ip}` : ''}. Not yet trusted. If you don’t recognise it, change your Wi-Fi password and check the router.`, source: 'network', kind: 'net:new', eventIds: [ev.id] });
    }
    for (const a of seen) {
      if (a.trusted) { this.hq.deviceSeen({ id: `asset:${a.id}`, label: a.name, type: 'net', owner: a.owner }); continue; }
      const ev = this.hq.logEvent({ kind: 'network', level: 'warn', message: `Untrusted device still on your network: ${a.name}` });
      this.hq.ops.raise({ severity: 'LOW', title: `Untrusted device on your network — ${a.name}`, explanation: `Seen again in the router list. Mark it trusted in the asset register if you know it, or remove it from your Wi-Fi.`, source: 'network', kind: `net:untrusted:${a.id}`, eventIds: [ev.id] });
    }
    this.publish();
    return { found: rows.length, added: added.length, seen: seen.length };
  }

  // ---------- unusual behaviour ----------
  /** An Agent dropping from Wi-Fi to mobile data can mean the Wi-Fi was switched off or jammed. */
  agentNet(id, { prevNet, status }) {
    if (!prevNet || !status.net || prevNet === status.net) return;
    const wifi = (n) => /wifi|ethernet/.test(n);
    if (!(wifi(prevNet) && !wifi(status.net) && status.net !== 'unknown')) return;
    const a = this.db.agent(id);
    if (!a) return;
    const ev = this.hq.logEvent({ kind: 'network', agentId: id, level: 'warn', message: `${agentLabel(a)} ${a.codename} switched from Wi-Fi to ${status.net}` });
    this.hq.ops.raise({ severity: 'MEDIUM', title: `Agent left the Wi-Fi — ${a.codename}`, explanation: `It is now on ${status.net}. The Wi-Fi may be down, switched off or being interfered with.`, source: 'network', kind: 'net:wifi', agentId: id, eventIds: [ev.id] });
  }
  /** A linked phone opening HQ at an hour it has never been used before (after 2 weeks of history). */
  phoneSeen(ev) {
    const key = `phonehours:${ev.data.device}`;
    const h = new Date(ev.ts).getHours();
    const hist = this.db.getSetting(key, null) || { n: 0, hours: Array(24).fill(0), first: ev.ts };
    if (hist.n >= 10 && this.now() - hist.first > 14 * 86400000 && hist.hours[h] === 0 && hist.hours[(h + 23) % 24] === 0 && hist.hours[(h + 1) % 24] === 0) {
      this.hq.ops.raise({ severity: 'LOW', title: `Linked phone used at an unusual time — ${ev.data.device}`, explanation: `“${ev.data.device}” opened HQ at ${String(h).padStart(2, '0')}:00, which it has not done in ${hist.n} previous visits. If that wasn’t you, unlink the phone (Settings › Phones).`, source: 'network', kind: 'net:phonehour', eventIds: [ev.id] });
    }
    hist.n++; hist.hours[h]++;
    this.db.setSetting(key, hist);
  }

  // ---------- health check ----------
  async health() {
    let persisted = null;
    try { persisted = (await globalThis.navigator?.storage?.persisted?.()) ?? null; } catch { /* unknown */ }
    const loc = globalThis.location;
    const d = this.db.getSetting('director', null);
    const facts = {
      now: this.now(), https: loc ? loc.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(loc.hostname) : true, persisted,
      autoLockMin: this.hq.settings().autoLockMin, twoFactor: d ? !!d.totp : null, pinStrength: d?.strength || null,
      viewers: this.db.viewers(), assets: this.assets(), answers: this.db.getSetting('routerChecks', {}),
    };
    return { ...healthCheck(facts), checks: ROUTER_CHECKS, answers: facts.answers };
  }
  setAnswers(answers = {}) {
    const clean = {};
    for (const c of ROUTER_CHECKS) if (['yes', 'no', 'unknown'].includes(answers[c.id])) clean[c.id] = answers[c.id];
    this.db.setSetting('routerChecks', clean);
    return clean;
  }
  history() { return history(this.hq.netmon?.stats || this.db.getSetting('netstats', null), this.now()); }
}
