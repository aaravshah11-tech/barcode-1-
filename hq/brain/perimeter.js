// PERIMETER (HQ's side): every minute, warns once about a garage / shed door left open and about someone
// lingering at the front; GET /perimeter gives the Perimeter screen its zones, visits and open doors.
import { ZONES, zoneStatus, frontVisits, openDoors } from '../../shared/perimeter.js';
import { isDark } from '../../shared/sun.js';

export class Perimeter {
  constructor({ hq, db }) { this.hq = hq; this.db = db; this.warned = new Set(this.db.getSetting('perimWarned', [])); }
  start() { this.timer = setInterval(() => this.tick(), 60000); return this; }
  stop() { clearInterval(this.timer); }

  input() {
    const now = this.hq.now(), since = new Date(now).setHours(0, 0, 0, 0);
    return { now, since, events: this.db.events({ since: Math.min(since, now - 6 * 3600000), limit: 20000 }), agents: this.hq.snapshot().agents, house: this.hq.house() };
  }
  view() {
    const x = this.input(), s = this.hq.settings();
    return {
      zones: ZONES.map(([z, label]) => ({ ...zoneStatus(z, x), label })),
      visits: frontVisits(x.events, x),
      open: openDoors(x.events, x),
      garageOpenMin: s.garageOpenMin || 15,
      dark: s.location ? isDark(x.now, s.location.lat, s.location.lon) : null,
    };
  }
  warnOnce(key, alert) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.db.setSetting('perimWarned', [...this.warned].slice(-200));
    this.hq.ops.raise(alert);
  }
  tick() {
    const x = this.input(), s = this.hq.settings();
    const dark = s.location ? isDark(x.now, s.location.lat, s.location.lon) : new Date(x.now).getHours() >= 20 || new Date(x.now).getHours() < 7;
    const serious = dark || s.mode === 'away' || s.mode === 'night' || s.mode === 'lockdown';
    for (const d of openDoors(x.events, x)) {
      if (d.mins < (s.garageOpenMin || 15)) continue;
      this.warnOnce(`open:${d.agentId}:${d.since}`, {
        severity: serious ? 'ALERT' : 'ADVISORY', title: `Garage / shed door left open — ${d.name}`, kind: 'door', agentId: d.agentId, source: 'agent', zone: 'garage',
        explanation: `Open for ${d.mins} minutes${dark ? ' and it’s dark' : ''}${s.mode !== 'home' ? ` while ${s.mode.toUpperCase()}` : ''}.`,
      });
    }
    for (const v of frontVisits(x.events, x)) {
      if (!v.lingering || !v.ongoing) continue;
      this.warnOnce(`linger:${v.start}`, {
        severity: 'ADVISORY', title: 'Someone lingering at the front', kind: 'perimeter', cls: 'person', zone: 'front', source: 'system', eventIds: v.eventIds.slice(-20),
        explanation: `A person has been at the front for ${v.mins} minutes without the door being opened.`,
      });
    }
  }
}
