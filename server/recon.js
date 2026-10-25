// Wi-Fi recon ("who's home"). Every minute HQ:
//   1. sends a tiny "hello?" packet to every address on the home network, so devices answer,
//   2. reads the computer's ARP table (the list of "this network address = this device"),
//   3. marks each person HOME if one of their devices was seen within the grace period.
// Nothing leaves the house: this only looks at your own Wi-Fi.
import os from 'node:os';
import fs from 'node:fs';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { newId } from './security.js';
import { normMac, isPrivateMac, parseArpBsd, parseIpNeigh, parseProcArp, parseArpWindows, hostsIn, presence } from './recon-core.js';

const VIRTUAL = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tailscale|lo|awdl|llw|bridge)/i;
const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout: 8000, windowsHide: true }, (e, out) => (e ? reject(e) : resolve(String(out)))));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The home networks this computer is on, e.g. [{ address: '192.168.1.10', netmask: '255.255.255.0' }]. */
function homeNetworks() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

/** Step 1: poke every address with an empty UDP packet (port 9 = "discard"), so the ARP table fills in. */
async function nudge(nets) {
  const hosts = nets.flatMap((n) => hostsIn(n.address, n.netmask).filter((ip) => ip !== n.address));
  if (!hosts.length) return 0;
  const sock = dgram.createSocket('udp4');
  sock.on('error', () => {});
  const buf = Buffer.alloc(1);
  for (let i = 0; i < hosts.length; i += 64) {
    await Promise.all(hosts.slice(i, i + 64).map((ip) => new Promise((r) => sock.send(buf, 9, ip, () => r()))));
    await wait(5);
  }
  sock.close();
  return hosts.length;
}

/** Step 2: read the ARP table, whatever computer HQ is running on. */
async function readArp() {
  if (process.platform === 'win32') return { method: 'arp -a', list: parseArpWindows(await run('arp', ['-a'])) };
  if (process.platform === 'linux') {
    try { return { method: 'ip neigh', list: parseIpNeigh(await run('ip', ['-4', 'neigh'])) }; } catch {}
    return { method: '/proc/net/arp', list: parseProcArp(fs.readFileSync('/proc/net/arp', 'utf8')) };
  }
  return { method: 'arp -an', list: parseArpBsd(await run('arp', ['-an'])) }; // macOS & friends
}

export function startRecon({ hq, db, log = () => {} }) {
  const status = { lastScan: null, lastError: null, method: '', count: 0, scanning: false };
  const triedName = new Map(); // mac -> when we last tried to look up its name
  let timer = null, stopped = false, current = null;

  async function lookUpNames(list) {
    const known = new Map(db.devices().map((d) => [d.mac, d]));
    await Promise.all(list.slice(0, 40).map(async (e) => {
      if (known.get(e.mac)?.hostname || Date.now() - (triedName.get(e.mac) || 0) < 30 * 60000) return;
      triedName.set(e.mac, Date.now());
      try { e.hostname = (await Promise.race([dns.reverse(e.ip), wait(1500).then(() => [])]))[0]?.replace(/\.(local|lan|home|localdomain)\.?$/i, '') || null; } catch {}
    }));
  }

  async function readTable() {
    const fake = process.env.SENTINEL_FAKE_ARP; // used by the tests: a JSON file of [{ ip, mac, hostname }]
    if (fake) return { method: 'test file', list: JSON.parse(fs.readFileSync(fake, 'utf8')).map((e) => ({ ...e, mac: normMac(e.mac) })).filter((e) => e.mac) };
    const nets = homeNetworks();
    if (!nets.length) throw new Error('HQ is not connected to a home network (Wi-Fi or Ethernet).');
    await nudge(nets);
    await wait(2000); // give devices a moment to answer
    const t = await readArp();
    t.list = t.list.filter((e) => !VIRTUAL.test(e.iface || ''));
    await lookUpNames(t.list);
    return t;
  }

  /** Re-work-out who's home and log arrivals/departures. */
  function evaluate() {
    const now = hq.now();
    const { graceMin } = hq.settings();
    const people = db.people();
    let changed = false;
    for (const r of presence(people, db.devices(), now, graceMin)) {
      const p = people.find((x) => x.id === r.id);
      const home = p.enabled && r.home;
      const patch = { lastSeen: r.lastSeen };
      if (home !== p.home) {
        Object.assign(patch, { home, since: now });
        changed = true;
        if (p.enabled) hq.logEvent({ kind: home ? 'arrival' : 'departure', message: home ? `${p.name} arrived home` : `${p.name} left home (not seen on Wi-Fi for ${graceMin} min)`, data: { personId: p.id } });
      } else if (r.lastSeen !== p.lastSeen) changed = true;
      db.updatePerson(p.id, patch);
    }
    if (changed) { hq.broadcast({ t: 'people', people: db.people() }); hq.recomputeThreat(); }
  }

  async function scan() {
    if (current) return current;
    status.scanning = true;
    current = (async () => {
      try {
        const { method, list } = await readTable();
        const now = hq.now();
        for (const e of list) db.seenDevice(e, now);
        Object.assign(status, { lastScan: now, lastError: null, method, count: list.length });
      } catch (e) {
        if (status.lastError !== e.message) log(`  Wi-Fi recon: ${e.message}`);
        status.lastError = e.message;
      }
      evaluate();
    })().finally(() => { status.scanning = false; current = null; });
    return current;
  }

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => { await scan(); schedule(); }, hq.settings().scanEvery * 1000);
  };
  scan().then(schedule);

  const view = () => {
    const s = hq.settings();
    return {
      people: db.people(),
      devices: db.devices().map((d) => ({ ...d, private: isPrivateMac(d.mac) })),
      status: { ...status },
      settings: { graceMin: s.graceMin, scanEvery: s.scanEvery },
    };
  };

  async function api(req, res, url, { sendJson, readJson }) {
    const p = url.pathname, m = req.method;
    if (p === '/api/recon' && m === 'GET') return sendJson(res, 200, view());
    if (p === '/api/recon/scan' && m === 'POST') { await scan(); return sendJson(res, 200, view()); }
    if (p === '/api/people' && m === 'POST') {
      const name = String((await readJson(req)).name || '').trim().slice(0, 40);
      if (!name) return sendJson(res, 400, { error: 'Type a name.' });
      db.addPerson({ id: newId(), name });
      hq.broadcast({ t: 'people', people: db.people() });
      return sendJson(res, 200, view());
    }
    let mm = p.match(/^\/api\/people\/([\w-]{1,40})$/);
    if (mm) {
      if (!db.people().some((x) => x.id === mm[1])) return sendJson(res, 404, { error: 'No such person.' });
      if (m === 'PATCH') {
        const b = await readJson(req), patch = {};
        if ('name' in b) { patch.name = String(b.name || '').trim().slice(0, 40); if (!patch.name) return sendJson(res, 400, { error: 'Type a name.' }); }
        if ('enabled' in b) patch.enabled = !!b.enabled;
        db.updatePerson(mm[1], patch);
      } else if (m === 'DELETE') db.removePerson(mm[1]);
      else return false;
      hq.broadcast({ t: 'people', people: db.people() });
      evaluate(); hq.recomputeThreat();
      return sendJson(res, 200, view());
    }
    mm = p.match(/^\/api\/devices\/([0-9a-fA-F:%A-]{11,40})$/);
    if (mm) {
      const mac = normMac(decodeURIComponent(mm[1]));
      if (!mac || !db.devices().some((d) => d.mac === mac)) return sendJson(res, 404, { error: 'No such device.' });
      if (m === 'PATCH') {
        const b = await readJson(req), patch = {};
        if ('name' in b) patch.name = String(b.name || '').trim().slice(0, 40);
        if ('ignored' in b) patch.ignored = !!b.ignored;
        if ('personId' in b) {
          if (b.personId && !db.people().some((x) => x.id === b.personId)) return sendJson(res, 400, { error: 'No such person.' });
          patch.personId = b.personId || null;
        }
        db.updateDevice(mac, patch);
      } else if (m === 'DELETE') db.removeDevice(mac);
      else return false;
      evaluate();
      return sendJson(res, 200, view());
    }
    return false;
  }

  return { api, scan, evaluate, stop() { stopped = true; clearTimeout(timer); } };
}
