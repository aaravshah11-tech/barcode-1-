// Phone logging pad for live matches (rugby & hockey). Cricket has its own pad.
import * as store from '../../core/store.js';
import { players, numberIn, team, playerLabel } from '../../core/people.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { esc, icon, openSheet, toast, confirmDialog, fmtClock, keepAwake } from '../../core/ui.js';
import { SPORT_INFO, match, eventsOf, sideName, sideColor, refLabel, clockMs, periodMs, matchTime, minuteOf, startClock, pauseClock, nextPeriod, setClock, logEvent, squadOf, lineupOf, TEAM_SIZE } from './common.js';
import { defaultStarters, wholeMinutes } from './lineup.js';
import { RUGBY_EVENTS, RUGBY_GROUPS, rugbyDef, lastKicker } from './rugby.js';
import { HOCKEY_EVENTS, HOCKEY_GROUPS, hockeyDef } from './hockey.js';
import { summarize } from './summary.js';
import { renderCricketLive } from './cricket-live.js';

export const SPORT_EVENTS = {
  rugby: { list: RUGBY_EVENTS, groups: RUGBY_GROUPS, def: rugbyDef },
  hockey: { list: HOCKEY_EVENTS, groups: HOCKEY_GROUPS, def: hockeyDef },
};
export const eventLabel = (m, e) => SPORT_EVENTS[m.sport]?.def(e.type)?.label || e.type;

/** Players we can pick for a side: our match squad, or the opponent's players / shirt numbers. */
export function pickPlayer(m, side, title, { only = null, note = null, empty = 'Nobody to choose.' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let opts;
    if (side === 'us') {
      const squad = squadOf(m).filter((p) => !only || only.includes(p.id));
      opts = squad.map((p) => ({ ref: p.id, num: numberIn(p, m.teamId) ?? '', name: p.name.split(' ').slice(-1)[0] }))
        .sort((a, b) => (+a.num || 999) - (+b.num || 999));
    } else {
      const ps = m.oppTeamId ? players(m.oppTeamId) : [];
      opts = ps.length ? ps.map((p) => ({ ref: p.id, num: numberIn(p, m.oppTeamId) ?? '', name: p.name.split(' ').slice(-1)[0] }))
        : Array.from({ length: 23 }, (_, i) => ({ ref: `opp#${i + 1}`, num: i + 1, name: '' }));
    }
    const s = openSheet(`${opts.length ? '' : `<p class="muted">${esc(empty)}</p>`}<div class="pick-grid">${opts.map((o, i) => `<button class="pick" data-i="${i}" aria-label="${esc(`${o.num} ${o.name}`.trim())}"><b>${esc(o.num)}</b><span>${esc(note ? note(o.ref) : o.name)}</span></button>`).join('')}</div>
      <button class="btn btn-lg btn-block" data-skip style="margin-top:10px">Not sure / skip</button>`, { title, onClose: () => resolve(result) });
    s.body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      result = 'skip' in b.dataset ? '' : opts[+b.dataset.i].ref;
      s.close();
    });
  });
}

/** Rugby: right after a try, ask "Conversion made / missed?" with the usual kicker ready. */
export function offerConversion(matchId, side) {
  return new Promise((resolve) => {
    let kicker = lastKicker(eventsOf(matchId), side);
    let busy = false;
    const m = match(matchId);
    const s = openSheet(`<p class="muted" style="margin-top:0">${esc(sideName(m, side))} scored a try. Conversion?</p>
      <button class="crease-row" data-kicker style="width:100%;margin-bottom:12px"></button>
      <div class="pad conv-pad">
        <button class="pad-btn score big" data-conv="made">✓ Made <small>+2</small></button>
        <button class="pad-btn card-red" data-conv="missed">✗ Missed</button>
        <button class="pad-btn" data-conv="skip">Not taken</button>
      </div>`, { title: 'Conversion', onClose: () => resolve() });
    const drawKicker = () => {
      s.body.querySelector('[data-kicker]').innerHTML = `<span>🦶 Kicker: <b>${kicker ? esc(refLabel(match(matchId), kicker)) : 'choose…'}</b></span><span class="small muted">Change</span>`;
    };
    drawKicker();
    s.body.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || busy) return;
      if ('kicker' in b.dataset) {
        const k = await pickPlayer(match(matchId), side, 'Who is kicking?');
        if (k !== null) { kicker = k; drawKicker(); }
        return;
      }
      const what = b.dataset.conv;
      if (!what) return;
      if (what === 'skip') { s.close(); return; }
      busy = true;
      if (!kicker) {
        const k = await pickPlayer(match(matchId), side, 'Who kicked?');
        if (k === null) { busy = false; return; }
        kicker = k;
      }
      await logEvent(match(matchId), { type: what === 'made' ? 'conv' : 'conv_miss', side, player: kicker });
      feedback(what === 'made' ? 'ok' : 'dup');
      s.close();
    });
  });
}

/** Active suspensions (sin bin / green / yellow): remaining match-time ms. */
export function suspensions(m, events, now = Date.now()) {
  const def = SPORT_EVENTS[m.sport]?.def;
  if (!def) return [];
  const nowMT = matchTime(m, m.clock?.period || 1, clockMs(m, now));
  return events.filter((e) => def(e.type)?.binMins).map((e) => {
    const end = matchTime(m, e.period, e.clockMs) + (e.binMins || def(e.type).binMins) * 60000;
    return { e, remaining: end - nowMT };
  }).filter((x) => x.remaining > 0);
}

/** Choose the starting line-up (toggle grid). Resolves to the saved match or null. */
export function chooseStarters(matchId) {
  return new Promise((resolve) => {
    const m = match(matchId);
    const squad = squadOf(m).map((p) => ({ ref: p.id, num: numberIn(p, m.teamId) ?? '', name: p.name.split(' ').slice(-1)[0] }))
      .sort((a, b) => (+a.num || 999) - (+b.num || 999));
    const size = TEAM_SIZE[m.sport] || 15;
    const picked = new Set(m.starters?.length ? m.starters : defaultStarters(squad.map((x) => x.ref), (r) => squad.find((x) => x.ref === r)?.num, size));
    let saved = null;
    const s = openSheet(`<p class="muted" style="margin-top:0">Tap to choose who starts. Everyone else is on the bench. Minutes played are worked out from this and your substitutions.</p>
      <div class="pick-grid" data-grid></div><p class="center" data-count style="font-weight:700"></p>
      <button class="btn btn-primary btn-lg btn-block" data-done>Done</button>`, { title: 'Starting line-up', onClose: () => resolve(saved) });
    const draw = () => {
      s.body.querySelector('[data-grid]').innerHTML = squad.map((o) => `<button class="pick ${picked.has(o.ref) ? 'on' : ''}" data-ref="${esc(o.ref)}" aria-pressed="${picked.has(o.ref)}"><b>${esc(o.num)}</b><span>${esc(o.name)}</span></button>`).join('');
      s.body.querySelector('[data-count]').textContent = `${picked.size} starting${picked.size !== size ? ` (usually ${size})` : ''} · ${squad.length - picked.size} on the bench`;
    };
    draw();
    s.body.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ref) { picked.has(b.dataset.ref) ? picked.delete(b.dataset.ref) : picked.add(b.dataset.ref); draw(); }
      if ('done' in b.dataset) { saved = await store.put('matches', { ...match(matchId), starters: [...picked] }); s.close(); }
    });
  });
}

/** Read-only "who's on now" sheet with minutes. */
function showLineup(matchId) {
  const m = match(matchId);
  const lu = lineupOf(m);
  if (!lu) return chooseStarters(matchId);
  const all = squadOf(m);
  const row = (p) => `<div class="list-item"><span class="badge" style="min-width:34px">${esc(numberIn(p, m.teamId) ?? '')}</span><div class="grow">${esc(p.name)}</div><span class="mono small">${wholeMinutes(lu.minutes[p.id])}′</span></div>`;
  const on = all.filter((p) => lu.onField.includes(p.id));
  const bench = all.filter((p) => !lu.onField.includes(p.id));
  const s = openSheet(`<div class="section-title">On the field (${on.length})</div><div class="list">${on.map(row).join('') || '<div class="list-item muted">Nobody</div>'}</div>
    <div class="section-title" style="margin-top:14px">Bench / off (${bench.length})</div><div class="list">${bench.map((p) => row(p).replace('</div><span', `${lu.sentOff.includes(p.id) ? ' <span class="tag tag-danger">sent off</span>' : ''}</div><span`)).join('') || '<div class="list-item muted">Nobody</div>'}</div>
    <button class="btn btn-block" data-edit-starters style="margin-top:12px">Change starting line-up</button>`, { title: 'Line-up & minutes' });
  s.body.querySelector('[data-edit-starters]').onclick = () => { s.close(); chooseStarters(matchId); };
}

export function renderLive(root, [id], ctx) {
  const m0 = match(id);
  if (!m0) { root.innerHTML = '<div class="empty"><h2>Match not found</h2><a class="btn" href="#/sports">Back</a></div>'; return; }
  if (m0.sport === 'cricket') return renderCricketLive(root, [id], ctx);
  ctx.hideNav(true);
  const cfg = SPORT_EVENTS[m0.sport];
  let side = 'us';
  let release = null;
  keepAwake().then((r) => { release = r; });

  const draw = () => {
    const m = match(id);
    const events = eventsOf(id);
    const s = summarize(m, events);
    const period = m.clock?.period || 1;
    const periods = m.format?.periods || SPORT_INFO[m.sport].periods;
    root.innerHTML = `<div class="live">
      <div class="scorebar">
        <div class="sb-team" style="--sc:${esc(sideColor(m, 'us'))}"><span>${esc(sideName(m, 'us'))}</span><b data-score-us>${s.score.us}</b></div>
        <div class="sb-mid"><div class="sb-clock" data-clock>0:00</div><div class="sb-period">${esc(SPORT_INFO[m.sport].periodName(period, periods))}</div></div>
        <div class="sb-team" style="--sc:${esc(sideColor(m, 'them'))}"><b data-score-them>${s.score.them}</b><span>${esc(sideName(m, 'them'))}</span></div>
      </div>
      <div class="clock-row">
        <button class="btn btn-lg ${m.clock?.running ? '' : 'btn-ok'}" data-clock-toggle>${m.clock?.running ? `${icon('pause')} Pause` : `${icon('play')} ${clockMs(m) ? 'Resume' : period === 1 ? 'Kick-off' : 'Start'}`}</button>
        ${period < periods ? `<button class="btn btn-lg" data-next>${icon('next')} End ${m.sport === 'rugby' ? 'half' : 'quarter'}</button>` : `<button class="btn btn-lg" data-finish>${icon('flag')} Full time</button>`}
        <button class="icon-btn" data-clock-edit aria-label="Adjust clock">${icon('clock')}</button>
      </div>
      <div data-bins></div>
      ${(() => {
        if (!squadOf(m).length) return '';
        const lu = lineupOf(m, events);
        return lu
          ? `<button class="lineup-row" data-lineup><span>🟢 On field <b>${lu.onField.length}</b> · Bench <b>${squadOf(m).length - lu.onField.length}</b></span><span class="small">Line-up & minutes ›</span></button>`
          : `<button class="lineup-row need" data-starters><span>👥 <b>Choose your starting line-up</b></span><span class="small">for minutes played ›</span></button>`;
      })()}
      <div class="side-toggle" role="group" aria-label="Which team?">
        <button data-side="us" aria-pressed="${side === 'us'}" style="--sc:${esc(sideColor(m, 'us'))}">${esc(sideName(m, 'us'))}</button>
        <button data-side="them" aria-pressed="${side === 'them'}" style="--sc:${esc(sideColor(m, 'them'))}">${esc(sideName(m, 'them'))}</button>
      </div>
      ${cfg.groups.map((g) => `<div class="pad-group"><div class="section-title">${esc(g)}</div><div class="pad">
        ${cfg.list.filter((e) => e.group === g).map((e) => `<button class="pad-btn ${e.big ? 'big' : ''} ${e.card ? 'card-' + e.card : ''} ${e.pts ? 'score' : ''}" data-ev="${e.type}">${esc(e.label)}${e.pts ? `<small>+${e.pts}</small>` : ''}</button>`).join('')}
      </div></div>`).join('')}
      <div class="live-links"><a class="btn btn-ghost" href="#/sports/match/${esc(id)}">${icon('chart')} Stats & timeline</a><a class="btn btn-ghost" href="#/photo/tag/${esc(id)}">📸 Photo tags</a></div>
      <div class="undo-bar" data-undo-bar></div>
    </div>`;
    drawUndo(m, events);
    tick();
  };

  const drawUndo = (m, events) => {
    const last = events[events.length - 1];
    root.querySelector('[data-undo-bar]').innerHTML = last
      ? `<div class="grow"><b>${minuteOf(m, last)}′ ${esc(eventLabel(m, last))}</b> <span class="muted">${esc(last.player ? refLabel(m, last.player) : sideName(m, last.side))}${last.player2 ? ` ↔ ${esc(refLabel(m, last.player2))}` : ''}</span></div><button class="btn btn-danger" data-undo>${icon('undo')} Undo</button>`
      : '<div class="grow muted">Tap a button to log what happens.</div>';
  };

  const tick = () => {
    const m = match(id);
    if (!m || !root.isConnected) return;
    const ms = clockMs(m);
    const over = ms - periodMs(m);
    const el = root.querySelector('[data-clock]');
    if (el) { el.textContent = over > 0 ? `${fmtClock(periodMs(m))} +${fmtClock(over)}` : fmtClock(ms); el.classList.toggle('over', over > 0); el.classList.toggle('running', !!m.clock?.running); }
    const bins = suspensions(m, eventsOf(id));
    const b = root.querySelector('[data-bins]');
    if (b) b.innerHTML = bins.length ? `<div class="bins">${bins.map((x) => `<span class="bin card-${esc(x.e.type)}">${esc(refLabel(m, x.e.player) || sideName(m, x.e.side))} · ${fmtClock(x.remaining)}</span>`).join('')}</div>` : '';
  };
  const timer = setInterval(tick, 500);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    unlockAudio();
    const m = match(id);
    const d = b.dataset;
    if ('starters' in d) { await chooseStarters(id); draw(); return; }
    if ('lineup' in d) { showLineup(id); return; }
    if (d.side) { side = d.side; root.querySelectorAll('[data-side]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.side === side)); return; }
    if ('clockToggle' in d) { m.clock?.running ? await pauseClock(m) : await startClock(m); return; }
    if ('next' in d) { if (await confirmDialog({ title: 'End this period?', message: 'The clock stops and resets for the next period.', confirmLabel: 'End period' })) await nextPeriod(m); return; }
    if ('finish' in d) {
      if (await confirmDialog({ title: 'Full time?', message: 'The match is marked as finished. You can still edit events later.', confirmLabel: 'Full time' })) {
        const p = await pauseClock(m);
        await store.put('matches', { ...p, status: 'done' });
        location.hash = `#/sports/match/${id}`;
      }
      return;
    }
    if ('clockEdit' in d) {
      const { promptDialog } = await import('../../core/ui.js');
      const v = await promptDialog({ title: 'Set the clock (minutes:seconds)', value: fmtClock(clockMs(m)), confirmLabel: 'Set' });
      const mm = String(v || '').match(/^(\d+)(?::(\d{1,2}))?$/);
      if (mm) await setClock(m, (+mm[1] * 60 + +(mm[2] || 0)) * 1000);
      return;
    }
    if ('undo' in d) {
      const last = eventsOf(id).at(-1);
      if (last) { await store.remove('events', last.id); feedback('dup'); toast(`Undone: ${eventLabel(m, last)}`); }
      return;
    }
    if (d.ev) {
      const def = cfg.def(d.ev);
      const forSide = side;
      let player = '', player2 = '';
      if (def.sub) {
        const lu = forSide === 'us' ? lineupOf(m) : null;
        const mins = (r) => (lu ? `${wholeMinutes(lu.minutes[r])}′` : '');
        player = await pickPlayer(m, forSide, 'Player coming OFF', lu ? { only: lu.onField, note: mins, empty: 'Nobody is on the field yet.' } : {});
        if (player === null) return;
        const bench = lu ? squadOf(m).map((p) => p.id).filter((r) => !lu.onField.includes(r) && !lu.sentOff.includes(r)) : null;
        player2 = await pickPlayer(m, forSide, 'Player coming ON', bench ? { only: bench, empty: 'Nobody left on the bench.' } : {});
        if (player2 === null) return;
      } else if (def.player) {
        player = await pickPlayer(m, forSide, `${def.label} — who?`);
        if (player === null) return; // closed the picker: cancel
      }
      const fresh = match(id);
      await logEvent(fresh, { type: d.ev, side: forSide, player, player2, binMins: def.binMins });
      feedback(def.card ? 'dup' : 'ok');
      if (!fresh.clock?.running && fresh.status !== 'done') toast('Logged — tip: start the clock so events get the right minute.', { kind: 'warn' });
      side = 'us'; // back to our team after each event
      if (m.sport === 'rugby' && d.ev === 'try') await offerConversion(id, forSide);
      draw(); // sheets were open, so make sure the pad shows the latest score
    }
  });

  draw();
  const off = store.onChange(({ changes }) => {
    if (changes.some((c) => (c.c === 'events' && (c.record.matchId === id || c.prev?.matchId === id)) || (c.c === 'matches' && c.record.id === id))) {
      if (!document.querySelector('.sheet-backdrop')) draw();
    }
  });
  return () => { clearInterval(timer); off(); release?.(); };
}
