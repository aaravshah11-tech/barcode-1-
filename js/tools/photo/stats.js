// Photo stats: shots, keeper rate, missed moments, best standing spots.
import { esc, plural } from '../../core/ui.js';
import { bars, pctText } from '../../core/charts.js';
import { matches, sideName } from '../sports/common.js';
import { MOMENT_TYPES, momentLabel, spotAt, trueTime } from './match.js';
import { photosOf, momentsOf, shoot, CHECKLIST } from './data.js';
import { SPOTS } from './touchline.js';

const keeper = (p) => p.flag === 'pick' || (p.rating || 0) >= 3;

export function renderStats(root) {
  const ms = matches().filter((m) => photosOf(m.id).length);
  const all = ms.flatMap((m) => photosOf(m.id));
  const keepers = all.filter(keeper);
  // Moments you keep missing: tagged moments with no keeper photo, by type.
  const missed = {}, totalMom = {};
  const spot = {};
  for (const m of ms) {
    const ph = photosOf(m.id);
    const sh = shoot(m.id);
    for (const mo of momentsOf(m.id)) {
      totalMom[mo.type] = (totalMom[mo.type] || 0) + 1;
      if (!ph.some((p) => p.momentId === mo.id && keeper(p))) missed[mo.type] = (missed[mo.type] || 0) + 1;
    }
    for (const p of ph) {
      if (p.cameraMs == null || !sh.positions.length) continue;
      const s = spotAt(sh.positions, trueTime(p.cameraMs, sh.offsetMs));
      if (!s) continue;
      const x = (spot[s] ||= { shots: 0, keep: 0 });
      x.shots++; if (keeper(p)) x.keep++;
    }
  }
  const unticked = {};
  ms.forEach((m) => CHECKLIST.forEach((c) => { if (!shoot(m.id).checklist[c.id]) unticked[c.label] = (unticked[c.label] || 0) + 1; }));
  root.innerHTML = `<h1>Photo stats</h1>
    ${!ms.length ? '<div class="card muted">Import some match photos to see stats.</div>' : `
    <div class="stat-grid"><div class="stat"><b>${all.length.toLocaleString()}</b><span>Photos</span></div><div class="stat"><b>${keepers.length}</b><span>Keepers (pick or 3★+)</span></div>
      <div class="stat"><b>${pctText(keepers.length, all.length)}</b><span>Keeper rate</span></div><div class="stat"><b>${ms.length}</b><span>Matches</span></div></div>
    <div class="two-col section">
      <div class="card"><h2>Moments you keep missing</h2><p class="small muted">Tagged moments with no keeper photo.</p>${bars(MOMENT_TYPES.filter((t) => totalMom[t.id]).map((t) => [t.label, missed[t.id] || 0, `${missed[t.id] || 0} of ${totalMom[t.id]}`]).sort((a, b) => b[1] - a[1]), { color: 'var(--danger)' })}</div>
      <div class="card"><h2>Best spots (keeper rate)</h2><p class="small muted">From the positions you logged.</p>${bars(Object.entries(spot).map(([s, x]) => [SPOTS.find((y) => y.id === s)?.label || s, Math.round((x.keep / x.shots) * 100), `${pctText(x.keep, x.shots)} of ${x.shots}`]).sort((a, b) => b[1] - a[1]), { max: 100, empty: 'Log “I’m here” on the Where to stand page during a match.' })}</div>
      <div class="card"><h2>Checklist gaps</h2>${bars(Object.entries(unticked).sort((a, b) => b[1] - a[1]), { color: 'var(--warn)', empty: 'You ticked everything!' })}</div>
      <div class="card"><h2>Per match</h2><div class="table-wrap"><table class="table"><thead><tr><th>Match</th><th class="num">Shots</th><th class="num">Keepers</th><th class="num">%</th></tr></thead><tbody>
        ${ms.map((m) => { const ph = photosOf(m.id); const k = ph.filter(keeper).length; return `<tr><td><a href="#/photo/match/${esc(m.id)}">${esc(sideName(m, 'us'))} v ${esc(sideName(m, 'them'))}</a><div class="small muted">${esc(m.date || '')}</div></td><td class="num">${ph.length}</td><td class="num">${k}</td><td class="num">${pctText(k, ph.length)}</td></tr>`; }).join('')}</tbody></table></div></div>
    </div>`}`;
  void plural; void momentLabel;
}
