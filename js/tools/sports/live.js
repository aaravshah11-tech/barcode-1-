// Phone logging pad for live matches (rugby & hockey). Cricket has its own pad.
import * as store from '../../core/store.js';
import { players, numberIn, team, playerLabel } from '../../core/people.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { esc, icon, openSheet, toast, confirmDialog, fmtClock, keepAwake } from '../../core/ui.js';
import { SPORT_INFO, match, eventsOf, sideName, sideColor, refLabel, clockMs, periodMs, matchTime, minuteOf, startClock, pauseClock, nextPeriod, setClock, logEvent } from './common.js';
import { RUGBY_EVENTS, RUGBY_GROUPS, rugbyDef } from './rugby.js';
import { HOCKEY_EVENTS, HOCKEY_GROUPS, hockeyDef } from './hockey.js';
import { summarize } from './summary.js';
import { renderCricketLive } from './cricket-live.js';

export const SPORT_EVENTS = {
  rugby: { list: RUGBY_EVENTS, groups: RUGBY_GROUPS, def: rugbyDef },
  hockey: { list: HOCKEY_EVENTS, groups: HOCKEY_GROUPS, def: hockeyDef },
};
export const eventLabel = (m, e) => SPORT_EVENTS[m.sport]?.def(e.type)?.label || e.type;

/** Players we can pick for a side: our match squad, or the opponent's players / shirt numbers. */
export function pickPlayer(m, side, title) {
  return new Promise((resolve) => {
    let result = null;
    let opts;
    if (side === 'us') {
      const squad = (m.squad?.length ? m.squad.map((id) => store.get('players', id)).filter(Boolean) : players(m.teamId));
      opts = squad.map((p) => ({ ref: p.id, num: numberIn(p, m.teamId) ?? '', name: p.name.split(' ').slice(-1)[0] }))
        .sort((a, b) => (+a.num || 999) - (+b.num || 999));
    } else {
      const ps = m.oppTeamId ? players(m.oppTeamId) : [];
      opts = ps.length ? ps.map((p) => ({ ref: p.id, num: numberIn(p, m.oppTeamId) ?? '', name: p.name.split(' ').slice(-1)[0] }))
        : Array.from({ length: 23 }, (_, i) => ({ ref: `opp#${i + 1}`, num: i + 1, name: '' }));
    }
    const s = openSheet(`<div class="pick-grid">${opts.map((o, i) => `<button class="pick" data-i="${i}"><b>${esc(o.num)}</b><span>${esc(o.name)}</span></button>`).join('')}</div>
      <button class="btn btn-lg btn-block" data-skip style="margin-top:10px">Not sure / skip</button>`, { title, onClose: () => resolve(result) });
    s.body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      result = 'skip' in b.dataset ? '' : opts[+b.dataset.i].ref;
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
        player = await pickPlayer(m, forSide, 'Player coming OFF');
        if (player === null) return;
        player2 = await pickPlayer(m, forSide, 'Player coming ON');
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
