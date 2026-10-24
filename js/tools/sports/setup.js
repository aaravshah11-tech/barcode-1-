// New match form (all sports).
import * as store from '../../core/store.js';
import { teams, players, team, numberIn } from '../../core/people.js';
import { teamForm } from '../../settings/teams.js';
import { esc, icon, todayIso, isPhone, toast } from '../../core/ui.js';
import { SPORT_INFO } from './common.js';
import { FORMATS } from './cricket.js';

const PRESETS = {
  rugby: [[2, 40, 'Adult 2×40'], [2, 35, '2×35 (U18)'], [2, 30, '2×30 (U16)'], [2, 25, '2×25'], [2, 20, '2×20']],
  hockey: [[4, 15, '4×15'], [2, 35, '2×35'], [4, 10, '4×10 (junior)'], [2, 25, '2×25']],
};

export function renderSetup(root, [sport = 'rugby', editId]) {
  const info = SPORT_INFO[sport];
  const editing = editId ? store.get('matches', editId) : null;
  const draw = () => {
    const mine = teams(sport).filter((t) => t.mine);
    const opps = teams(sport).filter((t) => !t.mine);
    const m = editing || {};
    const teamId = m.teamId || mine[0]?.id || '';
    const f = m.format || {};
    root.innerHTML = `<h1>${info.emoji} ${editing ? 'Edit match' : `New ${info.name.toLowerCase()} match`}</h1>
      ${mine.length ? '' : `<div class="banner banner-warn">${icon('users')}<div class="grow">You don’t have a ${esc(info.name.toLowerCase())} team yet.</div><button class="btn btn-sm" data-new-team>Create team</button></div>`}
      <form data-form>
        <div class="field-row">
          <label class="field"><span>My team</span><select name="teamId">${mine.map((t) => `<option value="${esc(t.id)}" ${t.id === teamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('') || '<option value="">— create a team first —</option>'}</select></label>
          <label class="field"><span>Opponent</span><select name="oppTeamId"><option value="">Type a name →</option>${opps.map((t) => `<option value="${esc(t.id)}" ${t.id === m.oppTeamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Opponent name</span><input name="oppName" value="${esc(m.oppName || '')}" placeholder="e.g. Riverside RFC" autocomplete="off"></label>
        <div class="field-row">
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(m.date || todayIso())}"></label>
          <label class="field"><span>Venue / town</span><input name="venue" value="${esc(m.venue || '')}" placeholder="e.g. Home ground, Bristol" autocomplete="off"></label>
        </div>
        <label class="check-row"><input type="checkbox" name="home" ${m.home !== false ? 'checked' : ''}> Home game</label>
        ${sport === 'cricket' ? `
          <div class="field-row">
            <label class="field"><span>Format</span><select name="fmt">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${(f.key || 't20') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
            <label class="field"><span>Overs per innings</span><input name="overs" type="number" min="1" max="100" value="${esc(f.overs || 20)}" inputmode="numeric"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Players per side</span><input name="playersPerSide" type="number" min="2" max="15" value="${esc(f.playersPerSide || 11)}" inputmode="numeric"></label>
            <label class="field"><span>Who bats first?</span><select name="batFirst"><option value="us" ${m.batFirst !== 'them' ? 'selected' : ''}>We bat first</option><option value="them" ${m.batFirst === 'them' ? 'selected' : ''}>They bat first</option></select></label>
          </div>` : `
          <div class="picker-row"><span class="field-label">Match length</span><div class="chips">${PRESETS[sport].map(([p, mins, l]) => `<button type="button" class="chip chip-sm" data-preset="${p}|${mins}" aria-pressed="${(f.periods || info.periods) === p && (f.periodMins || info.periodMins) === mins}">${l}</button>`).join('')}</div></div>
          <div class="field-row">
            <label class="field"><span>${sport === 'rugby' ? 'Halves' : 'Periods'}</span><input name="periods" type="number" min="1" max="8" value="${esc(f.periods || info.periods)}" inputmode="numeric"></label>
            <label class="field"><span>Minutes each</span><input name="periodMins" type="number" min="1" max="60" value="${esc(f.periodMins || info.periodMins)}" inputmode="numeric"></label>
          </div>`}
        <div class="section-title" style="margin-top:12px">Squad for this match</div>
        <div data-squad></div>
        <button class="btn btn-primary btn-lg btn-block" style="margin-top:16px" ${mine.length ? '' : 'disabled'}>${editing ? 'Save' : isPhone() ? 'Create & start logging' : 'Create match'}</button>
      </form>`;
    drawSquad();
  };
  const drawSquad = () => {
    const form = root.querySelector('[data-form]');
    const tid = form.teamId.value;
    const ps = players(tid);
    const chosen = new Set(editing?.squad || ps.map((p) => p.id));
    root.querySelector('[data-squad]').innerHTML = ps.length
      ? `<div class="chips">${ps.map((p) => `<label class="chip chip-sm"><input type="checkbox" data-sq="${esc(p.id)}" ${chosen.has(p.id) ? 'checked' : ''} style="width:18px;height:18px"> ${esc(numberIn(p, tid) ?? '')} ${esc(p.name)}</label>`).join('')}</div>`
      : `<p class="muted small">No players in this team yet — add them in <a href="#/settings/teams">Settings › Teams & players</a>. You can still log team events.</p>`;
  };
  root.addEventListener('change', (e) => {
    if (e.target.name === 'teamId') drawSquad();
    if (e.target.name === 'fmt' && FORMATS[e.target.value].overs) root.querySelector('[name=overs]').value = FORMATS[e.target.value].overs;
    if (e.target.name === 'oppTeamId' && e.target.value) root.querySelector('[name=oppName]').value = team(e.target.value)?.name || '';
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.preset) {
      const [p, mins] = b.dataset.preset.split('|');
      root.querySelector('[name=periods]').value = p;
      root.querySelector('[name=periodMins]').value = mins;
      root.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }
    if (b && 'newTeam' in b.dataset) teamForm({ sport, mine: true }, () => draw());
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.teamId.value) return;
    const opp = f.oppName.value.trim() || team(f.oppTeamId.value)?.name || 'Opposition';
    const format = sport === 'cricket'
      ? { key: f.fmt.value, overs: Math.max(1, +f.overs.value || 20), ballsPerOver: 6, playersPerSide: Math.max(2, +f.playersPerSide.value || 11) }
      : { periods: Math.max(1, +f.periods.value || info.periods), periodMins: Math.max(1, +f.periodMins.value || info.periodMins) };
    const squad = [...root.querySelectorAll('[data-sq]:checked')].map((x) => x.dataset.sq);
    const m = await store.put('matches', {
      ...(editing || {}), sport, teamId: f.teamId.value, oppTeamId: f.oppTeamId.value || '', oppName: opp,
      title: `${team(f.teamId.value)?.name || 'Us'} v ${opp}`, date: f.date.value, venue: f.venue.value.trim(), home: f.home.checked,
      format, squad, batFirst: sport === 'cricket' ? f.batFirst.value : undefined,
      status: editing?.status || 'upcoming', clock: editing?.clock || { period: 1, running: false, elapsedMs: 0 },
    });
    toast(editing ? 'Match saved' : 'Match created', { kind: 'ok' });
    location.hash = editing ? `#/sports/match/${m.id}` : isPhone() ? `#/sports/live/${m.id}` : `#/sports/match/${m.id}`;
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'teams') && !document.querySelector('.sheet-backdrop')) draw(); });
}
