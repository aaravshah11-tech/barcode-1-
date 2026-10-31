// WATCHDOG (HQ computer): keeps HQ running without anyone watching it.
//  - notices when the computer was asleep (timers jump) and records the gap
//  - a helper thread pings this page; if the page froze for a while, HQ records it and restarts itself
//  - if the link to Agents stays broken for 10 minutes while the internet works, HQ restarts itself
//  - a burst of errors also triggers a clean restart
// Everything is saved first, so a restart loses nothing.
const WORKER = `let last = Date.now(), waiting = false;
setInterval(() => { const now = Date.now(); if (waiting && now - last > 15000) postMessage({ hung: now - last }); if (!waiting) { waiting = true; last = now; postMessage({ ping: now }); } }, 2000);
onmessage = (e) => { if (e.data && e.data.pong) { const gap = Date.now() - last; waiting = false; if (gap > 15000) postMessage({ recovered: gap }); } };`;

export function startWatchdog({ api, net, flush = async () => {} }) {
  const report = (body) => api('/watchdog', { method: 'POST', body }).catch(() => {});
  let restarting = false;
  async function restart(why) {
    if (restarting) return;
    restarting = true;
    await report({ kind: 'reload', why });
    try { await flush(); } catch { /* still restart */ }
    setTimeout(() => location.reload(), 300);
  }
  // sleep: a 10-second timer that fires minutes late means the computer was asleep
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now(), gap = now - lastTick;
    lastTick = now;
    if (gap > 3 * 60000) report({ kind: 'sleep', ms: gap - 10000 });
  }, 10000);
  // hang: the helper thread keeps running even when this page is stuck
  try {
    const w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
    w.onmessage = (e) => {
      if (e.data.ping) w.postMessage({ pong: true });
      else if (e.data.recovered) { report({ kind: 'hang', ms: e.data.recovered }); if (e.data.recovered > 60000) restart('froze'); }
    };
  } catch { /* workers unavailable */ }
  // link: broken for 10 minutes while the internet itself works → restart the link
  let downSince = null;
  setInterval(() => {
    const s = net();
    if (s.state === 'online' || s.state === 'taken') { downSince = null; return; }
    downSince ??= Date.now();
    if (Date.now() - downSince > 10 * 60000 && navigator.onLine !== false) restart('link down');
  }, 30000);
  // errors: lots of them in a minute → restart cleanly
  let errs = [];
  addEventListener('error', () => { const now = Date.now(); errs = errs.filter((t) => now - t < 60000); errs.push(now); if (errs.length > 30) restart('errors'); });
  return { restart };
}
