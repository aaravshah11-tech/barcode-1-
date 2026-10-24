// Settings › Teams & players (shared by all sports and photography).
import * as store from '../core/store.js';
import { SPORTS, teams, players, numberIn } from '../core/people.js';
import { esc, icon, openSheet, promptDialog, confirmDialog, toast, plural } from '../core/ui.js';

const COLOURS = ['#1d4ed8', '#b91c1c', '#15803d', '#7e22ce', '#c2410c', '#0f766e', '#111827', '#ca8a04'];

export function teamForm(t = {}, onSaved) {
  const s = openSheet(`<form>
    <label class="field"><span>Team name *</span><input name="name" value="${esc(t.name)}" placeholder="e.g. Frontage 1st XV" required autocomplete="off"></label>
    <label class="field"><span>Club (optional)</span><input name="club" value="${esc(t.club)}" placeholder="e.g. Frontage Sports Club" autocomplete="off"></label>
    <div class="picker-row"><span class="field-label">Sport</span><div class="segmented">${SPORTS.map((x) => `<button type="button" data-sport="${x.id}" aria-pressed="${(t.sport || 'rugby') === x.id}">${x.emoji} ${x.name}</button>`).join('')}</div></div>
    <label class="check-row"><input type="checkbox" name="mine" ${t.mine !== false ? 'checked' : ''}> This is one of my teams (otherwise an opponent)</label>
    <div class="picker-row"><span class="field-label">Colour</span><div class="chips">${COLOURS.map((c) => `<button type="button" class="chip" data-colour="${c}" aria-pressed="${(t.colour || COLOURS[0]) === c}" style="background:${c};border-color:${c};width:44px;padding:0" aria-label="Colour ${c}"></button>`).join('')}</div></div>
    <div class="btn-row" style="margin-top:12px"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">${t.id ? 'Save' : 'Add team'}</button></div>
  </form>`, { title: t.id ? 'Edit team' : 'New team' });
  const f = s.body.querySelector('form');
  let sport = t.sport || 'rugby', colour = t.colour || COLOURS[0];
  f.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.sport) { sport = b.dataset.sport; f.querySelectorAll('[data-sport]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
    if (b?.dataset.colour) { colour = b.dataset.colour; f.querySelectorAll('[data-colour]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.name.value.trim()) return;
    const rec = await store.put('teams', { ...t, name: f.name.value.trim(), club: f.club.value.trim(), sport, mine: f.mine.checked, colour });
    s.close();
    onSaved?.(rec);
  };
}

/** "11 Sam Jones" lines -> [{number, name}] */
export function parseSquad(text) {
  return String(text || '').split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^#?(\d{1,3})[\s.,:-]+(.+)$/) || l.match(/^(.+?)[\s,]+#?(\d{1,3})$/);
    if (!m) return { name: l, number: null };
    return /^\d/.test(m[1]) ? { number: +m[1], name: m[2].trim() } : { name: m[1].trim(), number: +m[2] };
  });
}

function teamSheet(teamId) {
  const draw = (s) => {
    const t = store.get('teams', teamId);
    const ps = players(teamId);
    s.body.innerHTML = `<div class="btn-row" style="margin-bottom:12px"><button class="btn btn-sm" data-edit-team>${icon('edit')} Edit team</button><button class="btn btn-sm btn-danger" data-del-team>${icon('trash')} Delete team</button></div>
      <div class="section-title">Squad (${ps.length})</div>
      <div class="list">${ps.map((p) => `<div class="list-item"><span class="badge" style="min-width:36px;height:30px;font-size:.95rem;background:${esc(t.colour || 'var(--tool)')}">${esc(numberIn(p, teamId) ?? '–')}</span>
        <div class="grow"><b>${esc(p.name)}</b>${(p.teamIds || []).length > 1 ? `<div class="small muted">Also in ${esc(p.teamIds.filter((x) => x !== teamId).map((x) => store.get('teams', x)?.name).filter(Boolean).join(', '))}</div>` : ''}</div>
        <button class="icon-btn" data-edit-player="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button>
        <button class="icon-btn" data-remove-player="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from team">${icon('close')}</button></div>`).join('') || '<div class="list-item muted">No players yet.</div>'}</div>
      <div class="section-title" style="margin-top:16px">Add players</div>
      <textarea data-squad placeholder="One per line, number then name:\n1 Sam Jones\n2 Alex Smith\n15 Jo Brown"></textarea>
      <button class="btn btn-primary btn-block" data-add-squad style="margin-top:8px">${icon('plus')} Add these players</button>
      ${store.all('players').some((p) => !(p.teamIds || []).includes(teamId)) ? `<button class="btn btn-ghost btn-block" data-add-existing style="margin-top:6px">${icon('users')} Add someone from another team</button>` : ''}`;
  };
  const t0 = store.get('teams', teamId);
  const s = openSheet('', { title: t0.name });
  draw(s);
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    const t = store.get('teams', teamId);
    if ('editTeam' in d) { s.close(); teamForm(t); }
    else if ('delTeam' in d) {
      if (await confirmDialog({ title: `Delete ${t.name}?`, message: 'Players stay (they may be in other teams). Old matches keep their scores.', confirmLabel: 'Delete', danger: true })) { await store.remove('teams', teamId); s.close(); }
    } else if ('addSquad' in d) {
      const list = parseSquad(s.body.querySelector('[data-squad]').value);
      if (!list.length) return;
      await store.putMany('players', list.map((x) => ({ name: x.name, teamIds: [teamId], numbers: x.number != null ? { [teamId]: x.number } : {} })));
      toast(`Added ${plural(list.length, 'player')}`, { kind: 'ok' });
      draw(s);
    } else if (d.editPlayer) {
      const p = store.get('players', d.editPlayer);
      const name = await promptDialog({ title: 'Player name', value: p.name });
      if (!name) return;
      const num = await promptDialog({ title: `Shirt number in ${t.name}`, value: String(numberIn(p, teamId) ?? ''), inputmode: 'numeric' });
      await store.put('players', { ...p, name, numbers: { ...(p.numbers || {}), [teamId]: num === null || num === '' ? null : +num } });
      draw(s);
    } else if (d.removePlayer) {
      const p = store.get('players', d.removePlayer);
      const rest = (p.teamIds || []).filter((x) => x !== teamId);
      if (rest.length) await store.put('players', { ...p, teamIds: rest });
      else if (await confirmDialog({ title: `Remove ${p.name}?`, message: 'They’re not in any other team, so they’ll be deleted. Their past match stats stay.', confirmLabel: 'Remove', danger: true })) await store.remove('players', p.id);
      draw(s);
    } else if ('addExisting' in d) {
      const others = store.all('players').filter((p) => !(p.teamIds || []).includes(teamId)).sort((a, b) => a.name.localeCompare(b.name));
      const s2 = openSheet(`<div class="list">${others.map((p) => `<button class="list-item" data-pick="${esc(p.id)}"><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc((p.teamIds || []).map((x) => store.get('teams', x)?.name).filter(Boolean).join(', '))}</div></div>${icon('plus')}</button>`).join('')}</div>`, { title: 'Add from another team' });
      s2.body.addEventListener('click', async (ev) => {
        const pb = ev.target.closest('[data-pick]');
        if (!pb) return;
        const p = store.get('players', pb.dataset.pick);
        const num = await promptDialog({ title: `Shirt number in ${t.name}`, value: String(p.number ?? Object.values(p.numbers || {})[0] ?? ''), inputmode: 'numeric' });
        await store.put('players', { ...p, teamIds: [...(p.teamIds || []), teamId], numbers: { ...(p.numbers || {}), [teamId]: num ? +num : null } });
        s2.close();
        draw(s);
      });
    }
  });
}

export function renderTeams(root) {
  const draw = () => {
    root.innerHTML = `<div class="page-head"><h1>Teams & players</h1><button class="btn btn-primary" data-new-team>${icon('plus')} New team</button></div>
      <p class="muted">A club can have several sides (e.g. a rugby 1st XV, a cricket 1st XI and a hockey team). Players can be in more than one.</p>
      ${SPORTS.map((sp) => {
        const ts = teams(sp.id);
        return `<div class="section"><div class="section-title">${sp.emoji} ${sp.name}</div>
          <div class="list">${ts.map((t) => `<button class="list-item" data-team="${esc(t.id)}"><span style="width:14px;height:14px;border-radius:4px;background:${esc(t.colour || '#888')};flex:none"></span>
            <div class="grow"><b>${esc(t.name)}</b> ${t.mine ? '' : '<span class="tag">Opponent</span>'}<div class="small muted">${esc([t.club, plural(players(t.id).length, 'player')].filter(Boolean).join(' · '))}</div></div>${icon('chev', 'chev')}</button>`).join('') || '<div class="list-item muted small">No teams yet.</div>'}</div></div>`;
      }).join('')}`;
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('newTeam' in b.dataset) teamForm({}, (t) => teamSheet(t.id));
    else if (b.dataset.team) teamSheet(b.dataset.team);
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'teams' || c.c === 'players')) draw(); });
}
