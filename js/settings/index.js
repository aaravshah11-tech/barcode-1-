// Settings tool: overview + sub pages.
import * as store from '../core/store.js';
import * as sync from '../sync/manager.js';
import { esc, icon, toast, promptDialog, confirmDialog } from '../core/ui.js';
import { family, addFamily, removeFamily } from '../core/people.js';
import { renderLocations } from './locations.js';
import { renderTeams } from './teams.js';
import { renderPair } from './pair.js';
import { renderBackup } from './backup.js';

function overview(root) {
  const draw = () => {
    const st = sync.getState();
    const theme = (() => { try { return localStorage.getItem('hb.theme') || 'auto'; } catch { return 'auto'; } })();
    const contrast = document.documentElement.dataset.contrast === 'high';
    const syncText = st.mode === 'off' ? 'Not paired yet' : `${st.mode === 'cloud' ? 'Cloud (Supabase)' : 'Quick link'} · ${st.state === 'connected' ? 'connected' : st.state}`;
    root.innerHTML = `<h1>Settings</h1>
      <div class="list">
        <a class="list-item" href="#/settings/pair">${icon('link')}<div class="grow"><b>Pair phone & computer</b><div class="small muted">${esc(syncText)}</div></div>${icon('chev', 'chev')}</a>
        <a class="list-item" href="#/settings/locations">${icon('pin')}<div class="grow"><b>House locations</b><div class="small muted">Rooms, bookcases, cupboards, shelves, boxes</div></div>${icon('chev', 'chev')}</a>
        <a class="list-item" href="#/settings/teams">${icon('users')}<div class="grow"><b>Teams & players</b><div class="small muted">Shared by Rugby, Cricket, Hockey and Photography</div></div>${icon('chev', 'chev')}</a>
        <a class="list-item" href="#/settings/backup">${icon('download')}<div class="grow"><b>Backup & export</b><div class="small muted">JSON backup, CSV per tool, import</div></div>${icon('chev', 'chev')}</a>
      </div>

      <div class="section"><div class="section-title">Family members</div>
        <div class="card"><p class="small muted" style="margin-top:0">Used as owners and borrowers in Library and Inventory.</p>
          <div class="chips">${family().map((o) => `<button class="chip" data-del-family="${esc(o)}" aria-label="Remove ${esc(o)}">${esc(o)} ${icon('close')}</button>`).join('') || '<span class="muted small">No one added yet.</span>'}</div>
          <button class="btn btn-ghost btn-sm" data-add-family style="margin-top:10px">${icon('plus')} Add person</button></div>
      </div>

      <div class="section"><div class="section-title">Appearance</div>
        <div class="segmented" role="group" aria-label="Theme">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-theme="${v}" aria-pressed="${v === theme}">${l}</button>`).join('')}</div>
        <div class="list" style="margin-top:12px">
          <label class="list-item"><div class="grow"><b>Outdoor mode</b><div class="small muted">Black & white, high contrast, bigger text. Also the ◐ button at the top.</div></div><input type="checkbox" data-contrast ${contrast ? 'checked' : ''}></label>
          <label class="list-item"><div class="grow">Beep on scan / tap</div><input type="checkbox" data-pref="sound" ${store.getLocal('sound', true) ? 'checked' : ''}></label>
          <label class="list-item"><div class="grow">Vibrate <div class="small muted">Android only — iPhones don’t allow it</div></div><input type="checkbox" data-pref="vibrate" ${store.getLocal('vibrate', true) ? 'checked' : ''}></label>
        </div>
      </div>
      <p class="muted small center" style="margin-top:24px">HomeBase · your data stays on your devices${st.mode === 'cloud' ? ' and your own Supabase project' : ''}.</p>`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.theme) {
      try { localStorage.setItem('hb.theme', b.dataset.theme); } catch { /* ignore */ }
      if (b.dataset.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = b.dataset.theme;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else if ('addFamily' in b.dataset) {
      const n = await promptDialog({ title: 'Add a family member', placeholder: 'Name', confirmLabel: 'Add' });
      if (n) await addFamily(n);
    } else if (b.dataset.delFamily) {
      if (await confirmDialog({ title: `Remove ${b.dataset.delFamily}?`, message: 'Things they own keep their name; they just won’t be offered as a choice.', confirmLabel: 'Remove' })) await removeFamily(b.dataset.delFamily);
    }
  });
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.pref) await store.setLocal(t.dataset.pref, t.checked);
    if ('contrast' in t.dataset) {
      if (t.checked) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast;
      try { localStorage.setItem('hb.contrast', t.checked ? 'high' : ''); } catch { /* ignore */ }
    }
  });
  draw();
  const off1 = store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'settings')) draw(); });
  const off2 = sync.onState(draw);
  return () => { off1(); off2(); };
}

export default {
  routes: { '': overview, locations: renderLocations, teams: renderTeams, pair: renderPair, backup: renderBackup },
  nav: [
    { route: '', label: 'Settings', icon: 'gear' },
    { route: 'pair', label: 'Pairing', icon: 'link' },
    { route: 'locations', label: 'Locations', icon: 'pin' },
    { route: 'teams', label: 'Teams', icon: 'users' },
    { route: 'backup', label: 'Backup', icon: 'download' },
  ],
};
