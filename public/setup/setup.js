// The plain-HTTP "join HQ" page: checks whether this device already trusts HQ's certificate,
// shows how to install it if not, then hands over to the secure Agent page with the one-time code.
const $ = (s) => document.querySelector(s);
const show = (step) => document.querySelectorAll('[data-step]').forEach((el) => { el.hidden = el.dataset.step !== step; });
const params = new URLSearchParams(location.search);
let code = (params.get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const cfg = await fetch('/setup/config.json').then((r) => r.json()).catch(() => ({ httpsPort: 8443 }));
const secure = `https://${location.hostname}:${cfg.httpsPort}`;
const agentUrl = () => `${secure}/agent/${code ? `#pair=${encodeURIComponent(code)}` : ''}`;

// Open the right instructions for this device.
const ua = navigator.userAgent;
const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(ua) ? 'android' : 'other';
const det = document.querySelector(`details[data-os="${os}"]`);
if (det) det.open = true;

async function trusted() {
  try { const r = await fetch(`${secure}/api/ping`, { cache: 'no-store' }); return r.ok; } catch { return false; }
}
async function go() {
  if (!code) { show('code'); $('[data-codeform] input').focus(); return; }
  show('check');
  if (await trusted()) location.href = agentUrl(); else show('trust');
}
$('[data-codeform]').addEventListener('submit', (e) => {
  e.preventDefault();
  code = e.target.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length >= 6) { history.replaceState(null, '', `?c=${code}`); go(); }
});
$('[data-recheck]').addEventListener('click', async () => {
  $('[data-still]').hidden = true;
  if (await trusted()) location.href = agentUrl(); else $('[data-still]').hidden = false;
});
$('[data-anyway]').addEventListener('click', () => { location.href = agentUrl(); });
go();
