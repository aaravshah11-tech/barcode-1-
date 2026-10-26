// NETWORK INTEL (runs on the HQ computer): checks the internet connection every minute,
// keeps 24 h of history, logs outages, and runs speed tests (by hand, or every few hours).
// A web page can't list the devices on your Wi-Fi — that would need a separate helper program.
import { addSample, addSpeed, emptyStats, summary, mbps } from '../../shared/netstats.js';

const CHECK_EVERY = 60000;
const CF = 'https://speed.cloudflare.com';

export function startNetmon({ hq, db, base = location.href }) {
  let stats = db.getSetting('netstats', null) || emptyStats();
  let timer = null, speedTimer = null, testing = false;
  const mon = {
    probeUrl: new URL('../favicon.svg', base).href,
    get stats() { return stats; },
  };
  const save = () => db.setSetting('netstats', stats);
  const publish = () => hq.broadcast({ t: 'net', net: summary(stats, hq.now()) });

  /** One check: how long does a tiny request take? (null = no internet) */
  async function probe() {
    if (navigator.onLine === false) return null;
    const t0 = performance.now();
    try {
      const ctl = new AbortController();
      const kill = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(`${mon.probeUrl}${mon.probeUrl.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(kill);
      if (!r.ok) return null;
      await r.arrayBuffer();
      return performance.now() - t0;
    } catch { return null; }
  }

  mon.check = async () => {
    const ms = await probe();
    const r = addSample(stats, hq.now(), ms);
    stats = r.stats;
    save();
    if (r.change === 'down') hq.logEvent({ kind: 'system', level: 'warn', message: 'Internet connection lost' });
    if (r.change === 'up') hq.logEvent({ kind: 'system', message: `Internet connection restored (down ${fmtDur(r.downFor)})` });
    publish();
    return ms;
  };

  /** Speed test: Cloudflare’s public test server; if that’s blocked, a rougher estimate from this site. */
  mon.speedTest = async () => {
    if (testing) throw Object.assign(new Error('A speed test is already running.'), { status: 409 });
    testing = true;
    hq.broadcast({ t: 'netTesting', on: true });
    try {
      let result = null;
      try {
        const down = await timed(`${CF}/__down?bytes=8000000`, {}, 25000);
        const body = new Uint8Array(2000000);
        const up = await timed(`${CF}/__up`, { method: 'POST', body }, 25000, body.length);
        result = { t: hq.now(), down: mbps(down.bytes, down.ms), up: mbps(up.bytes, up.ms), server: 'Cloudflare' };
      } catch {
        const down = await timed(new URL('../vendor/three/three.module.js', base).href + `?_=${Date.now()}`, { cache: 'no-store' }, 25000);
        result = { t: hq.now(), down: mbps(down.bytes, down.ms), up: null, server: 'estimate (Cloudflare unreachable)' };
      }
      stats = addSpeed(stats, result);
      save();
      hq.logEvent({ kind: 'system', message: `Speed test: ${result.down} Mbps down${result.up != null ? ` · ${result.up} Mbps up` : ''} (${result.server})` });
      publish();
      return result;
    } finally { testing = false; hq.broadcast({ t: 'netTesting', on: false }); }
  };

  const scheduleSpeed = () => {
    clearInterval(speedTimer);
    const hrs = Number(hq.settings().speedEvery) || 0;
    if (hrs) speedTimer = setInterval(() => mon.speedTest().catch(() => {}), hrs * 3600000);
  };
  hq.on('broadcast', (m) => { if (m.t === 'settings') scheduleSpeed(); });
  scheduleSpeed();
  mon.check();
  timer = setInterval(mon.check, CHECK_EVERY);
  addEventListener('online', () => mon.check());
  addEventListener('offline', () => mon.check());
  mon.summary = () => summary(stats, hq.now());
  mon.stop = () => { clearInterval(timer); clearInterval(speedTimer); };
  return mon;
}

async function timed(url, opts, timeout, sentBytes = 0) {
  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), timeout);
  const t0 = performance.now();
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, mode: 'cors' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return { bytes: sentBytes || buf.byteLength, ms: performance.now() - t0 };
  } finally { clearTimeout(kill); }
}

export function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
