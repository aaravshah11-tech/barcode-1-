// One entry point to summarise any match, whatever the sport.
import { eventsOf, refLabel } from './common.js';
import { summarizeRugby } from './rugby.js';
import { summarizeHockey } from './hockey.js';
import { summarizeCricket } from './cricket.js';

export function summarize(m, events = eventsOf(m.id)) {
  if (m.sport === 'rugby') return summarizeRugby(events);
  if (m.sport === 'hockey') return summarizeHockey(events);
  if (m.sport === 'cricket') return summarizeCricket(m, events, (r) => refLabel(m, r, { short: true }));
  return { score: { us: 0, them: 0 } };
}

/** { us, them, text } — for cricket text is like "145/6 v 120/3". */
export function scoreOf(m, s = summarize(m)) {
  if (m.sport !== 'cricket') return { us: s.score.us, them: s.score.them, text: `${s.score.us}–${s.score.them}` };
  const us = s.total('us'), them = s.total('them');
  const t = (inn) => (inn.legal || inn.runs ? `${inn.runs}/${inn.wickets}` : '–');
  return { us: us.runs, them: them.runs, text: `${t(us)} v ${t(them)}` };
}
