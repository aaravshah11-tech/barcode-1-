// ANALYST view: ask questions in plain English, read the Current Picture and the morning SITREP, search the
// log in plain English, and set up the local model. Every reference is a link to its evidence; anything the
// Analyst suggests is a button you press yourself (it can't change anything on its own).
import { esc, $, toast, sheet, dayClock, confirmBox } from '../../shared/ui.js';

const clock = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const KIND_LABEL = { picture: 'Current Picture', sitrep: 'Morning SITREP', incident: 'Incident summary', anomaly: 'Explanation', tuning: 'Tuning advice', question: 'Answer' };

/** Text with [ALT-…] / [INC-…] / [EVT-…] turned into evidence links. */
export function withRefs(text) {
  return esc(text).replace(/\[?\b(ALT-\d{6}|INC-\d{4}-\d{4}|EVT-\d+)\b\]?/g, (_, r) => `<button type="button" class="ref" data-ref="${r}" title="Show the evidence">${r}</button>`).replace(/\n/g, '<br>');
}

/** ctx = { S, api, openIncident(id), showAlert(id) } */
export function createAnalyst(ctx) {
  const { S } = ctx;
  let root = null, status = null, convo = [], speaking = false;

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad analyst">
      <div class="an-grid">
        <section class="panel an-chat" aria-label="Conversation with the Analyst">
          <div class="row"><span class="lbl grow">Ask the Analyst</span><span class="small muted" data-anmodel></span></div>
          <div class="an-quick row">${[['picture', 'Current picture'], ['sitrep', 'Morning SITREP'], ['tuning', 'Tuning advice'], ['anomaly', 'Explain the latest anomaly']].map(([k, l]) => `<button class="small" data-ankind="${k}">${l}</button>`).join('')}</div>
          <ol class="an-log" data-anlog aria-live="polite"></ol>
          <form class="an-form" data-anform><input name="q" maxlength="500" autocomplete="off" placeholder="e.g. Was anyone in the garden last night?" aria-label="Question for the Analyst">
            <button type="button" class="icon-btn" data-anmic title="Speak the question" aria-label="Speak the question" hidden>🎙</button><button class="btn-primary">Ask</button></form>
          <p class="small muted">The Analyst only reads SENTINEL’s records, cites its evidence and can’t change anything — suggestions appear as buttons for you to press.</p>
        </section>
        <aside class="an-side">
          <section class="panel an-card" data-anpic></section>
          <section class="panel an-card" data-ansitrep></section>
          <section class="panel an-card" data-anstatus></section>
        </aside>
      </div>
      <section class="panel an-search"><span class="lbl">Search the log in plain English</span>
        <form class="row" data-ansearch><input name="q" maxlength="200" placeholder="e.g. people at the front yesterday · door events in the last 3 hours · motion in the kitchen last night" aria-label="Search the log"><button>Search</button></form>
        <div data-ansresults></div></section></div>`;
    root.addEventListener('click', onClick);
    $('[data-anform]', root).addEventListener('submit', (e) => { e.preventDefault(); const q = e.target.elements.q.value.trim(); if (q) { e.target.elements.q.value = ''; ask(q); } });
    $('[data-ansearch]', root).addEventListener('submit', (e) => { e.preventDefault(); search(e.target.elements.q.value.trim()); });
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Rec && S.settings?.analyst?.voice) $('[data-anmic]', root).hidden = false;
    drawLog(); load();
  }
  async function load() {
    try {
      const [st, pics, sits] = await Promise.all([ctx.api('/analyst/status'), ctx.api('/analyst/notes?kind=picture'), ctx.api('/analyst/notes?kind=sitrep')]);
      status = st; drawStatus(); drawNote('[data-anpic]', 'Current Picture', pics[0], 'picture'); drawNote('[data-ansitrep]', 'Morning SITREP', sits[0], 'sitrep');
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  const noteFoot = (n) => `<p class="small muted">${n.auto ? `Automatic summary (no model${n.reason ? `: ${esc(n.reason)}` : ''})` : `Analyst · ${esc(n.model || '')}`} · ${esc(dayClock(n.ts))}</p>`;
  function drawNote(sel, title, n, kind) {
    const box = root && $(sel, root);
    if (!box) return;
    box.innerHTML = `<div class="row"><span class="lbl grow">${title}</span><button class="small btn-ghost" data-ankind="${kind}">Refresh</button></div>${n ? `<p class="an-text">${withRefs(n.text)}</p>${noteFoot(n)}` : `<p class="small muted">${kind === 'picture' ? 'Written every 15 minutes.' : 'Written each morning at 07:00.'}</p>`}`;
  }
  function drawStatus() {
    const box = root && $('[data-anstatus]', root);
    if (!box) return;
    const a = { on: false, url: 'http://localhost:11434', model: '', voice: false, ...(S.settings?.analyst || {}) }, st = status || {};
    $('[data-anmodel]', root).textContent = st.ok ? `Model: ${st.model}` : 'Automatic summaries (no model)';
    box.innerHTML = `<div class="row"><span class="lbl grow">Local model</span><span class="zstate ${st.ok ? 'z-on' : 'z-warn'}"><span class="dot ${st.ok ? 'on' : 'warn'}"></span>${st.ok ? 'CONNECTED' : a.on ? 'NOT REACHABLE' : 'OFF'}</span></div>
      ${st.error && a.on ? `<p class="small c-amber">${esc(st.error)}</p>` : ''}
      <form data-anset class="an-set">
        <label class="row small"><input type="checkbox" name="on" ${a.on ? 'checked' : ''}> Use the local Analyst model (Ollama)</label>
        <label class="field"><span>Address (this computer or your home network only)</span><input name="url" value="${esc(a.url)}"></label>
        <label class="field"><span>Model</span>${st.models?.length ? `<select name="model">${st.models.map((m) => `<option ${m === (a.model || st.model) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : `<input name="model" value="${esc(a.model)}" placeholder="e.g. llama3.1:8b">`}</label>
        <label class="row small"><input type="checkbox" name="voice" ${a.voice ? 'checked' : ''}> Voice: read answers aloud and allow spoken questions</label>
        <div class="row"><button class="btn-primary">Save</button><button type="button" data-ancheck>Check connection</button><button type="button" class="btn-ghost" data-anhelp>Set up</button></div></form>`;
    $('[data-anset]', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try { S.settings = await ctx.api('/settings', { method: 'PATCH', body: { analyst: { on: f.on.checked, url: f.url.value, model: f.model.value, voice: f.voice.checked } } }); toast('Analyst settings saved'); status = await ctx.api('/analyst/status?force=1'); drawStatus(); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
  }
  function help() {
    sheet(`<div class="an-help"><p>The Analyst runs on <b>this Mac</b> with a free program called Ollama. Nothing leaves your home. Do this once:</p>
      <ol>
        <li>Download Ollama from <b>ollama.com</b> and install it (drag it to Applications, open it once).</li>
        <li>Open <b>Terminal</b> (Applications › Utilities) and paste, one line at a time:
          <pre>ollama pull llama3.1:8b</pre>
          <pre>launchctl setenv OLLAMA_ORIGINS "${esc(location.origin)}"</pre>
          The second line lets this SENTINEL page talk to Ollama. Then quit Ollama (menu-bar llama icon › Quit) and open it again.</li>
        <li>Use <b>Chrome</b> for HQ. If Chrome asks to let this site “access other apps and services on this device” or the local network, choose <b>Allow</b>.</li>
        <li>Here, tick <b>Use the local Analyst model</b>, press <b>Save</b>, then <b>Check connection</b>.</li>
      </ol>
      <p class="small muted">8 GB Mac: use <span class="mono">llama3.2:3b</span> instead (faster, a little less careful). 16 GB or more: <span class="mono">llama3.1:8b</span> or <span class="mono">qwen2.5:7b</span>. After a restart of the Mac, run the <span class="mono">launchctl</span> line again (or add it to a login item). Until it is set up, SENTINEL writes automatic summaries instead.</p></div>`, { title: 'Set up the Analyst', wide: true });
  }

  // ---------- conversation ----------
  async function ask(q, kind = 'question', ref = null) {
    const item = { q: q || KIND_LABEL[kind], kind, at: Date.now(), busy: true };
    convo.unshift(item); drawLog();
    try {
      const r = await ctx.api('/analyst/ask', { method: 'POST', body: { q, kind, ref } });
      Object.assign(item, { busy: false, r });
      if (kind === 'picture') drawNote('[data-anpic]', 'Current Picture', r, 'picture');
      if (kind === 'sitrep') drawNote('[data-ansitrep]', 'Morning SITREP', r, 'sitrep');
      if (S.settings?.analyst?.voice) speak(r.text);
    } catch (x) { Object.assign(item, { busy: false, err: x.message }); }
    drawLog();
    return item;
  }
  function drawLog() {
    const box = root && $('[data-anlog]', root);
    if (!box) return;
    box.innerHTML = convo.length ? convo.slice(0, 30).map((c, i) => `<li class="an-item"><div class="an-q"><span class="mono small muted">${clock(c.at)}</span> ${esc(c.q)}</div>
      ${c.busy ? '<div class="an-a muted small">Thinking… (a local model can take 10–60 seconds)</div>' : c.err ? `<div class="an-a c-red small">${esc(c.err)}</div>`
        : `<div class="an-a"><p class="an-text">${withRefs(c.r.text)}</p>${c.r.proposals?.length ? `<div class="row an-props"><span class="small muted">Suggested — you decide:</span>${c.r.proposals.map((p, j) => `<button class="small" data-anprop="${i}:${j}">${esc(p.label)}</button>`).join('')}</div>` : ''}
          <p class="small muted">${c.r.auto ? `Automatic answer (no model${c.r.reason ? `: ${esc(c.r.reason)}` : ''})` : `${esc(c.r.model)} · ${(c.r.ms / 1000).toFixed(1)} s${c.r.tools?.length ? ` · looked at: ${esc([...new Set(c.r.tools)].join(', '))}` : ''}`}${c.r.unknown?.length ? ` · <span class="c-amber">${c.r.unknown.length} reference${c.r.unknown.length === 1 ? '' : 's'} didn’t exist and ${c.r.unknown.length === 1 ? 'was' : 'were'} marked unverified</span>` : ''}${!c.r.auto && !c.r.cited ? ' · <span class="c-amber">no evidence cited — treat with care</span>' : ''}</p></div>`}</li>`).join('')
      : '<li class="small muted">Ask anything about what has happened: “What happened overnight?”, “Why was the garden alert raised?”, “Which Agent causes most false alarms?”</li>';
  }
  async function proposal(p) {
    if (!(await confirmBox(p.label, 'The Analyst suggested this. Do it now? It is recorded in the audit log as your action.', { ok: 'Do it' }))) return;
    try {
      if (p.action === 'mode') S.settings = await ctx.api('/settings', { method: 'PATCH', body: { mode: p.value, reason: 'Suggested by the Analyst' } });
      else if (p.action === 'acknowledge') await ctx.api(`/alerts/${p.ref}/acknowledge`, { method: 'POST', body: { note: 'Suggested by the Analyst' } });
      else if (p.action === 'incident') { const inc = await ctx.api('/incidents', { method: 'POST', body: { alertIds: [p.ref], note: 'Opened on the Analyst’s suggestion.' } }); ctx.openIncident(inc.id); }
      toast('Done');
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(String(text).replace(/\[[^\]]+\]/g, '')); u.lang = 'en-GB'; u.rate = 0.98; speechSynthesis.cancel(); speechSynthesis.speak(u); speaking = true; } catch { /* no voice */ }
  }
  function listen() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return;
    const r = new Rec(); r.lang = 'en-GB'; r.interimResults = false;
    r.onresult = (e) => { const q = e.results[0][0].transcript; if (q) ask(q); };
    r.onerror = () => toast('Didn’t catch that.');
    r.start(); toast('Listening…');
  }

  // ---------- plain-English search ----------
  async function search(q) {
    const box = $('[data-ansresults]', root);
    if (!q) { box.innerHTML = ''; return; }
    try {
      const r = await ctx.api('/analyst/search', { method: 'POST', body: { q } });
      box.innerHTML = `<p class="small">Understood as: <b>${esc(r.understood)}</b> — ${r.count} match${r.count === 1 ? '' : 'es'}${r.count > 100 ? ' (first 100 shown)' : ''}.</p>
        ${r.results.length ? `<ol class="log an-results">${r.results.map((e) => `<li class="${esc(e.level)}"><time>${esc(dayClock(e.ts))}</time><span><span class="mono small muted">${e.ref}</span> ${esc(e.message)}</span></li>`).join('')}</ol>` : ''}`;
    } catch (x) { box.innerHTML = `<p class="small c-red">${esc(x.message)}</p>`; }
  }
  async function showEvent(ref) {
    const id = Number(ref.slice(4));
    try {
      const list = await ctx.api(`/log?limit=50&before=${id + 1}`);
      const e = list.find((x) => x.id === id);
      sheet(e ? `<dl class="kv"><dt>Reference</dt><dd class="mono">${ref}</dd><dt>Time</dt><dd class="mono">${esc(new Date(e.ts).toLocaleString('en-GB'))}</dd><dt>Kind</dt><dd>${esc(e.kind)}</dd><dt>Message</dt><dd>${esc(e.message)}</dd>${e.data ? `<dt>Details</dt><dd class="mono small">${esc(JSON.stringify(e.data))}</dd>` : ''}</dl>` : '<p class="small muted">That event is no longer in the log (older than the retention period).</p>', { title: `Evidence ${ref}` });
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }

  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ref) {
      const r = b.dataset.ref;
      if (r.startsWith('ALT-')) ctx.showAlert(r);
      else if (r.startsWith('INC-')) { const inc = (S.incidents || []).find((i) => i.ref === r); if (inc) ctx.openIncident(inc.id); else toast(`${r} not found`); }
      else showEvent(r);
    } else if (b.dataset.ankind) {
      const kind = b.dataset.ankind;
      if (kind === 'anomaly') {
        const a = (S.alerts || []).find((x) => x.source === 'anomaly' || /^Unusual|anomal/i.test(x.title));
        if (!a) return toast('No anomaly alerts yet — the pattern of life needs about a week of history.');
        ask(`Explain ${a.id}`, 'anomaly', a.id);
      } else ask('', kind);
    } else if (b.dataset.anprop) {
      const [i, j] = b.dataset.anprop.split(':').map(Number);
      const p = convo[i]?.r?.proposals?.[j];
      if (p) proposal(p);
    } else if ('ancheck' in b.dataset) { try { status = await ctx.api('/analyst/status?force=1'); drawStatus(); toast(status.ok ? `Connected: ${status.model}` : status.error || 'Not reachable'); } catch (x) { toast(x.message, { kind: 'err' }); } }
    else if ('anhelp' in b.dataset) help();
    else if ('anmic' in b.dataset) listen();
  }
  return {
    render, ask, search,
    onNote(n) { if (!root?.isConnected) return; if (n.kind === 'picture') drawNote('[data-anpic]', 'Current Picture', n, 'picture'); if (n.kind === 'sitrep') drawNote('[data-ansitrep]', 'Morning SITREP', n, 'sitrep'); },
  };
}
