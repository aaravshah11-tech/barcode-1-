// ALERT FATIGUE: are you being alerted too often, and by what? Counts alerts per source over 7 days,
// how many you dismissed as false alarms, how long they waited, and suggests a fix. Pure, unit tested.
const DAY = 86400000;
export const sourceOf = (a) => a.agent || (a.source === 'correlation' ? `Rule: ${String(a.title).split(/\s[—(]/)[0]}` : a.source === 'system' ? 'System' : a.source || 'Other');

/** alerts = Triage alerts (any status). Returns { perDay, falseRate, medianWaitMin, sources: [...], level, advice } */
export function fatigueStats(alerts, now, { days = 7 } = {}) {
  const since = now - days * DAY;
  const recent = alerts.filter((a) => a.ts >= since && a.severity !== 'INFO');
  const isFalse = (a) => a.status === 'dismissed' && /false alarm|expected/i.test(a.dismissReason || '');
  const waits = recent.filter((a) => a.handledAt).map((a) => (a.handledAt - a.ts) / 60000).sort((x, y) => x - y);
  const by = new Map();
  for (const a of recent) {
    const k = sourceOf(a);
    const s = by.get(k) || { source: k, agentId: a.agentId || null, count: 0, falseAlarms: 0, repeats: 0 };
    s.count++; s.repeats += (a.count || 1) - 1;
    if (isFalse(a)) s.falseAlarms++;
    by.set(k, s);
  }
  const sources = [...by.values()].map((s) => ({ ...s, falseRate: Math.round((s.falseAlarms / s.count) * 100) }))
    .sort((a, b) => b.count - a.count);
  for (const s of sources) {
    s.noisy = s.count >= 5 && s.falseRate >= 50;
    s.advice = !s.noisy ? '' : s.agentId
      ? `${s.source}: ${s.falseRate}% of its ${s.count} alerts were false alarms. Lower its sensitivity, add ignore zones, or add a grading rule.`
      : `${s.source}: ${s.falseRate}% false alarms — consider a grading rule to lower it, or switch the rule off.`;
  }
  const perDay = Math.round((recent.length / days) * 10) / 10;
  const falseRate = recent.length ? Math.round((recent.filter(isFalse).length / recent.length) * 100) : 0;
  const medianWaitMin = waits.length ? Math.round(waits[Math.floor(waits.length / 2)]) : null;
  const level = perDay > 15 || falseRate >= 60 ? 'high' : perDay > 6 || falseRate >= 35 ? 'moderate' : 'low';
  return {
    perDay, falseRate, medianWaitMin, total: recent.length, sources, level,
    advice: level === 'low' ? 'Alert load is healthy.' : `Alert load is ${level}: ${perDay} a day, ${falseRate}% false alarms.${sources.find((s) => s.noisy) ? ` Noisiest: ${sources.find((s) => s.noisy).source}.` : ''}`,
  };
}

/** The daily digest text: the last 24 hours in a few lines. */
export function digest({ alerts, events, now, snoozed = 0 }) {
  const since = now - DAY;
  const day = alerts.filter((a) => a.ts >= since);
  const n = (s) => day.filter((a) => a.severity === s).length;
  const open = alerts.filter((a) => a.status === 'new').length;
  const activity = events.filter((e) => e.ts >= since && ['motion', 'door', 'sound', 'light', 'knock', 'perimeter'].includes(e.kind)).length;
  const f = fatigueStats(alerts, now);
  const lines = [
    `${day.length} alert${day.length === 1 ? '' : 's'} in the last 24 hours: ${n('CRITICAL')} critical, ${n('ALERT')} alert, ${n('ADVISORY')} advisory, ${n('INFO')} info.`,
    `${activity} sensor event${activity === 1 ? '' : 's'} recorded.${snoozed ? ` ${snoozed} alert${snoozed === 1 ? ' was' : 's were'} held back by snoozes.` : ''}`,
    open ? `${open} alert${open === 1 ? ' is' : 's are'} still unhandled in Triage.` : 'Nothing is waiting in Triage.',
    f.advice,
  ];
  return { title: `Daily digest — ${new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`, lines };
}
