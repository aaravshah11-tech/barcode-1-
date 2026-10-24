// 🏏 Cricket ball-by-ball scoring pad (phone).
import * as store from '../../core/store.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { esc, icon, openSheet, toast, choose, confirmDialog, keepAwake } from '../../core/ui.js';
import { match, eventsOf, sideName, refLabel } from './common.js';
import { summarizeCricket, WICKET_KINDS, WICKET_ON_EXTRA, oversText } from './cricket.js';
import { pickPlayer } from './live.js';

const ballText = (b) => {
  if (b.type !== 'ball' && b.type !== 'retire') return '';
  if (b.type === 'retire') return b.how === 'retired out' ? 'RO' : 'RH';
  if (b.wicket) return b.kind === 'wd' ? 'W+wd' : b.kind === 'nb' ? 'W+nb' : 'W';
  const r = b.runs || 0;
  return { wd: `${r ? r + 1 : ''}wd`, nb: `${r || ''}nb`, b: `${r}b`, lb: `${r}lb` }[b.kind] || (r ? String(r) : '•');
};

export function renderCricketLive(root, [id], ctx) {
  ctx.hideNav(true);
  let sel = { striker: null, nonStriker: null, bowler: null }; // manual choices that override the replay
  let busy = false;
  let release = null;
  keepAwake().then((r) => { release = r; });

  const state = () => {
    const m = match(id);
    const events = eventsOf(id);
    const s = summarizeCricket(m, events, (r) => refLabel(m, r, { short: true }));
    const n = s.current;
    const inn = s.innings[n - 1];
    const balls = events.filter((e) => e.type === 'ball' && (e.innings || 1) === n);
    const batting = s.sideOf(n);
    const bowling = batting === 'us' ? 'them' : 'us';
    return {
      m, s, n, inn, balls, batting, bowling,
      striker: sel.striker || inn.striker || null,
      nonStriker: sel.nonStriker || inn.nonStriker || null,
      bowler: sel.bowler || inn.bowler || null,
    };
  };

  const draw = () => {
    const st = state();
    const { m, s, n, inn, balls } = st;
    const perOver = m.format?.ballsPerOver || 6;
    const thisOver = (() => { let legal = 0; const cur = Math.floor(inn.legal / perOver); const out = []; for (const b of balls) { if (Math.floor(legal / perOver) === cur) out.push(b); if (b.kind !== 'wd' && b.kind !== 'nb') legal++; } return out; })();
    const bat = (r) => inn.batting.find((x) => x.ref === r);
    const bowler = inn.bowling.find((x) => x.ref === st.bowler);
    const matchOver = s.result || (n === 2 && inn.closed);
    root.innerHTML = `<div class="live cricket">
      <div class="scorebar cricket-bar">
        <div class="cb-main"><span>${esc(sideName(m, st.batting))} · ${n === 1 ? '1st' : '2nd'} innings</span>
          <b>${inn.runs}/${inn.wickets}</b><small>(${inn.overText} ov) · RR ${inn.runRate.toFixed(2)}</small></div>
        ${n === 2 && !inn.closed ? `<div class="cb-target">Need <b>${inn.needed}</b> from ${inn.ballsLeft} balls · RRR ${inn.requiredRate?.toFixed(2) ?? '–'}</div>` : n === 1 ? `<div class="cb-target muted">${esc(sideName(m, st.bowling))} bowling · ${m.format?.overs} overs</div>` : ''}
      </div>
      ${s.result ? `<div class="banner banner-ok">${icon('trophy')}<div class="grow"><b>${esc(s.result.winner ? sideName(m, s.result.winner) + ' ' + s.result.text : s.result.text)}</b></div></div>` : ''}
      ${matchOver ? `<button class="btn btn-primary btn-lg btn-block" data-finish>${icon('flag')} Finish match</button>` : `
      <div class="crease">
        <button class="crease-row ${st.striker ? '' : 'need'}" data-pick="striker"><span>🏏 ${st.striker ? `<b>${esc(refLabel(m, st.striker))}*</b>` : '<b>Choose striker</b>'}</span><span class="mono">${st.striker && bat(st.striker) ? `${bat(st.striker).runs} (${bat(st.striker).balls})` : ''}</span></button>
        <button class="crease-row ${st.nonStriker ? '' : 'need'}" data-pick="nonStriker"><span>${st.nonStriker ? esc(refLabel(m, st.nonStriker)) : '<b>Choose non-striker</b>'}</span><span class="mono">${st.nonStriker && bat(st.nonStriker) ? `${bat(st.nonStriker).runs} (${bat(st.nonStriker).balls})` : ''}</span></button>
        <button class="crease-row ${st.bowler ? '' : 'need'}" data-pick="bowler"><span>⚾ ${st.bowler ? esc(refLabel(m, st.bowler)) : `<b>Choose bowler${inn.lastBowler ? ' (new over)' : ''}</b>`}</span><span class="mono">${bowler ? `${bowler.overs}-${bowler.maidens}-${bowler.runs}-${bowler.wickets}` : ''}</span></button>
      </div>
      <div class="this-over">This over: ${thisOver.map((b) => `<span class="ball-chip ${b.wicket ? 'w' : b.runs >= 4 && b.kind === 'normal' ? 'b' : ''}">${esc(ballText(b))}</span>`).join('') || '<span class="muted">—</span>'}</div>
      <div class="pad pad-runs">${[0, 1, 2, 3, 4, 6].map((r) => `<button class="pad-btn run ${r >= 4 ? 'boundary' : ''}" data-runs="${r}">${r === 0 ? '•<small>dot</small>' : r}</button>`).join('')}</div>
      <div class="pad pad-extras">
        <button class="pad-btn" data-extra="wd">Wide</button><button class="pad-btn" data-extra="nb">No ball</button>
        <button class="pad-btn" data-extra="b">Bye</button><button class="pad-btn" data-extra="lb">Leg bye</button>
        <button class="pad-btn card-red big" data-wicket>WICKET</button>
      </div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-swap>⇄ Swap strike</button><button class="btn" data-retire>🩹 Retire batter</button><button class="btn" data-end-innings>End innings</button></div>`}
      ${n === 1 && inn.closed ? `<div class="banner">${icon('info')}<div class="grow">Innings over: ${esc(sideName(m, st.batting))} ${inn.runs}/${inn.wickets}. ${esc(sideName(m, st.bowling))} need ${inn.runs + 1}.</div></div>` : ''}
      <div class="live-links"><a class="btn btn-ghost" href="#/sports/match/${esc(id)}">${icon('chart')} Full scorecard</a></div>
      <div class="undo-bar" data-undo-bar>${balls.length || n === 2 ? `<div class="grow"><b>Last: ${esc(ballText(eventsOf(id).filter((e) => e.type === 'ball').at(-1) || {}) || '—')}</b></div><button class="btn btn-danger" data-undo>${icon('undo')} Undo</button>` : '<div class="grow muted">Choose the batters and bowler, then tap each ball.</div>'}</div>
    </div>`;
  };

  async function pickFor(slot, st) {
    const side = slot === 'bowler' ? st.bowling : st.batting;
    const title = slot === 'bowler' ? 'Who’s bowling?' : slot === 'striker' ? 'Batter on strike' : 'Non-striker';
    let opts;
    if (slot === 'bowler') {
      // Nobody bowls two overs in a row.
      const newOver = st.inn.legal % (st.m.format?.ballsPerOver || 6) === 0;
      opts = { exclude: newOver && st.inn.lastBowler ? [st.inn.lastBowler] : [] };
    } else {
      // Batters: not someone already out or at the crease; retired-hurt batters can come back.
      const out = st.inn.batting.filter((x) => x.out).map((x) => x.ref);
      const crease = [st.striker, st.nonStriker].filter(Boolean);
      const hurt = new Set(st.inn.batting.filter((x) => x.retired && !x.out).map((x) => x.ref));
      opts = { exclude: [...out, ...crease], note: hurt.size ? (r) => (hurt.has(r) ? 'returns' : refLabel(st.m, r, { short: true }).replace(/^#\d+ /, '')) : null };
    }
    const ref = await pickPlayer(st.m, side, title, opts);
    if (ref === null) return false;
    sel[slot] = ref || (slot === 'bowler' ? 'opp#?' : `${side === 'them' ? 'opp#' : 'name:'}Batter ${st.inn.batting.length + 1}`);
    return true;
  }

  /** Make sure we know striker, non-striker and bowler before recording a ball. */
  async function ensureCrease() {
    for (const slot of ['striker', 'nonStriker', 'bowler']) {
      const st = state();
      if (!st[slot]) { const ok = await pickFor(slot, st); if (!ok) return null; draw(); }
    }
    return state();
  }

  async function record(ball) {
    if (busy) return;
    busy = true;
    try {
      const st = await ensureCrease();
      if (!st) return;
      if (st.inn.closed) { toast('This innings is over.', { kind: 'warn' }); return; }
      await store.put('events', { matchId: id, sport: 'cricket', type: 'ball', t: Date.now(), innings: st.n, striker: st.striker, nonStriker: st.nonStriker, bowler: st.bowler, ...ball });
      if (st.m.status !== 'live') await store.put('matches', { ...match(id), status: 'live' });
      sel = { striker: null, nonStriker: null, bowler: null };
      feedback(ball.wicket ? 'dup' : 'ok');
      const after = state();
      if (after.n === 2 && st.n === 1) toast(`Innings over. Target: ${after.inn.target}`, { kind: 'ok', timeout: 5000 });
      draw();
      // Prompt for whoever is missing next (new batter after a wicket, new bowler after an over).
      if (!after.inn.closed && (!after.striker || !after.nonStriker || !after.bowler) && !(after.n === 2 && st.n === 1)) await ensureCrease();
      draw();
    } finally { busy = false; }
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    unlockAudio();
    const d = b.dataset;
    const st = state();
    if (d.runs !== undefined) record({ kind: 'normal', runs: +d.runs });
    else if (d.extra) {
      const labels = { wd: 'Wide — extra runs ran / boundary?', nb: 'No ball — runs off the bat?', b: 'Byes — how many?', lb: 'Leg byes — how many?' };
      const opts = (d.extra === 'b' || d.extra === 'lb' ? [1, 2, 3, 4] : [0, 1, 2, 3, 4, 6]).map((r) => ({ label: d.extra === 'wd' ? (r ? `+${r}` : 'Just the wide') : String(r), value: r }));
      const runs = await choose(labels[d.extra], opts, { columns: 3 });
      if (runs !== null) record({ kind: d.extra, runs });
    } else if ('wicket' in d) {
      const how = await choose('How out?', WICKET_KINDS.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: k })), { columns: 2 });
      if (!how) return;
      const ready = await ensureCrease();
      if (!ready) return;
      // Run outs, stumpings and hit wicket can happen off a wide; run outs off a no-ball too.
      let kind = 'normal';
      if (WICKET_ON_EXTRA.wd.includes(how)) {
        const kinds = [{ label: 'Normal ball', value: 'normal' }, { label: 'Wide', value: 'wd' }];
        if (WICKET_ON_EXTRA.nb.includes(how)) kinds.push({ label: 'No ball', value: 'nb' });
        kind = await choose('Which ball was it?', kinds, { columns: kinds.length });
        if (!kind) return;
      }
      let out = ready.striker, runs = 0, fielder = '';
      if (how === 'run out') {
        out = await choose('Who is out?', [{ label: `${refLabel(ready.m, ready.striker)} (striker)`, value: ready.striker }, { label: `${refLabel(ready.m, ready.nonStriker)} (non-striker)`, value: ready.nonStriker }]);
        if (!out) return;
        runs = await choose(kind === 'wd' ? 'Extra runs completed (on top of the wide)?' : 'Runs completed before the run out?', [0, 1, 2, 3].map((r) => ({ label: String(r), value: r })), { columns: 4 });
        if (runs === null) return;
      }
      if (['caught', 'run out', 'stumped'].includes(how)) {
        fielder = await pickPlayer(ready.m, ready.bowling, how === 'caught' ? 'Caught by?' : how === 'stumped' ? 'Wicket-keeper?' : 'Fielder?');
        if (fielder === null) fielder = '';
      }
      record({ kind, runs, wicket: { how, out, fielder } });
    } else if ('retire' in d) {
      const ready = await ensureCrease();
      if (!ready) return;
      const who = await choose('Who is retiring?', [{ label: `${refLabel(ready.m, ready.striker)} (striker)`, value: ready.striker }, { label: `${refLabel(ready.m, ready.nonStriker)} (non-striker)`, value: ready.nonStriker }]);
      if (!who) return;
      const how = await choose('How?', [{ label: 'Retired hurt — can bat again later', value: 'retired hurt' }, { label: 'Retired out — counts as a wicket', value: 'retired out' }]);
      if (!how) return;
      busy = true;
      try {
        await store.put('events', { matchId: id, sport: 'cricket', type: 'retire', innings: ready.n, batter: who, how, t: Date.now() });
        sel = { striker: null, nonStriker: null, bowler: sel.bowler };
        feedback('dup');
        toast(`${refLabel(ready.m, who)} ${how}`);
        draw();
        if (!state().inn.closed) await ensureCrease();
      } finally { busy = false; }
      draw();
    } else if (d.pick) { await pickFor(d.pick, st); draw(); }
    else if ('swap' in d) { sel = { ...sel, striker: st.nonStriker, nonStriker: st.striker }; draw(); }
    else if ('endInnings' in d) {
      if (await confirmDialog({ title: 'End this innings?', message: 'Use this for a declaration or if play is stopped.', confirmLabel: 'End innings' })) {
        await store.put('events', { matchId: id, sport: 'cricket', type: 'innings_end', innings: st.n, t: Date.now() });
        sel = { striker: null, nonStriker: null, bowler: null };
      }
    } else if ('undo' in d) {
      const last = eventsOf(id).filter((x) => x.type === 'ball' || x.type === 'innings_end' || x.type === 'retire').at(-1);
      if (last) { await store.remove('events', last.id); sel = { striker: null, nonStriker: null, bowler: null }; feedback('dup'); toast('Last ball undone'); }
    } else if ('finish' in d) {
      await store.put('matches', { ...match(id), status: 'done' });
      location.hash = `#/sports/match/${id}`;
    }
  });

  draw();
  const off = store.onChange(({ changes }) => {
    if (changes.some((c) => (c.c === 'events' && (c.record.matchId === id || c.prev?.matchId === id)) || (c.c === 'matches' && c.record.id === id))) {
      if (!document.querySelector('.sheet-backdrop') && !busy) draw();
    }
  });
  return () => { off(); release?.(); };
}
export { oversText };
