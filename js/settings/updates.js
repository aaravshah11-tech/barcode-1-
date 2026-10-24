// Settings › Updates: your version, check for a newer one, and what's new.
import { esc, icon, formatDate } from '../core/ui.js';
import { checkForUpdate, applyUpdate, forceFreshCopy, shortVersion } from '../core/updates.js';

export function renderUpdates(root) {
  let st = { state: 'checking' }; // checking | done | error
  const entry = (e, isNew) => `<div class="list-item cl-entry ${isNew ? 'cl-new' : ''}"><div class="grow">
      <b>${esc(e.title)}</b>${isNew ? ' <span class="tag">New</span>' : ''} <span class="small muted">${esc(formatDate(e.date))}</span>
      <ul class="cl-items">${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div></div>`;
  const draw = () => {
    const r = st.result;
    const status = st.state === 'checking' ? `<div class="banner">${icon('refresh')}<div class="grow">Checking for updates…</div></div>`
      : st.state === 'error' ? `<div class="banner banner-warn">${icon('alert')}<div class="grow">${navigator.onLine === false ? 'You’re offline, so HomeBase can’t check right now.' : 'Couldn’t reach the HomeBase website just now.'}</div><button class="btn btn-sm" data-check>Try again</button></div>`
      : r.available ? `<div class="banner banner-warn upd-ready">${icon('download')}<div class="grow"><b>A new version is ready.</b>${r.news.length ? ` ${r.news.length} change${r.news.length === 1 ? '' : 's'} since yours — see below.` : ''}</div><button class="btn btn-primary" data-update ${st.updating ? 'disabled' : ''}>${st.updating ? 'Updating…' : 'Update now'}</button></div>`
      : `<div class="banner banner-ok">${icon('check')}<div class="grow"><b>You’re up to date.</b></div><button class="btn btn-sm" data-check>Check again</button></div>`;
    const news = r?.news || [];
    const old = (r?.log || []).filter((e) => !news.includes(e));
    root.innerHTML = `<div class="page-head"><h1>Updates</h1></div>
      <p class="muted">This device has version <span class="mono">${esc(shortVersion())}</span>. Updating keeps all your data — it just loads the newest app.</p>
      ${status}
      ${news.length ? `<div class="section"><div class="section-title">What you’ll get</div><div class="list">${news.map((e) => entry(e, true)).join('')}</div></div>` : ''}
      ${old.length ? `<div class="section"><div class="section-title">${news.length ? 'Earlier changes' : 'What’s new'}</div><div class="list">${old.slice(0, 8).map((e) => entry(e, false)).join('')}</div></div>` : ''}
      <p class="small muted" style="margin-top:20px">Still seeing the old version after updating? <button class="link-btn" data-force>Load a completely fresh copy</button> (your data stays).</p>`;
  };
  const check = async () => {
    st = { state: 'checking' };
    draw();
    try { st = { state: 'done', result: await checkForUpdate() }; } catch { st = { state: 'error' }; }
    if (root.isConnected) draw();
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('check' in b.dataset) check();
    if ('update' in b.dataset) { st.updating = true; draw(); await applyUpdate(); }
    if ('force' in b.dataset) forceFreshCopy();
  });
  check();
}
