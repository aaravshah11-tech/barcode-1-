// WHAT'S NEW: the changelog shown in Settings › What's new. Newest first. Add an entry for every update.
export const VERSION = '3.8.0';
export const CHANGELOG = [
  { version: '3.8.0', date: '2026-10-31', title: 'Data and resilience', items: [
    'Everything HQ saves is now encrypted at rest (AES-256), with a key the browser won’t let anyone copy out. Older data is converted automatically.',
    'Nightly encrypted backups after 03:00, each one test-restored straight away. Back up now, test again, restore, or download an encrypted backup file with your own password.',
    'Retention screen: choose how long the event log, alerts, incidents, reports, shift log, analysis and audit log are kept.',
    'Evidence export for incidents: one file with a SHA-256 fingerprint that is also written into the audit log, plus a checker that proves the file hasn’t been changed.',
    'Watchdog: HQ notices when it was closed, asleep, crashed or frozen, restarts itself if it freezes, and records every gap. Linked phones warn you when HQ can’t be reached.',
    'This “What’s new” page.',
  ] },
  { version: '3.7.0', date: '2026-10-30', title: 'Access control', items: [
    'Users with roles: Director, Operator and Observer — checked by HQ on every request, from the HQ computer and from phones.',
    'Optional two-step sign-in with an authenticator app.',
    'Sessions screen: see who is signed in and from where; end any session.',
    'Tamper-evident audit log of every sign-in, change and refused attempt, with export and checksum.',
    'Shift log with handover notes; formal “Alert state” change log showing who changed it and why.',
  ] },
  { version: '3.6.0', date: '2026-10-30', title: 'Reporting', items: [
    'Daily SITREP, weekly PDF report (with reference number, charts and classification banners) and a custom report builder.',
  ] },
  { version: '3.5.0', date: '2026-10-29', title: 'Network security', items: [
    'Asset register built from SENTINEL’s own devices, your own entries and your router’s device list — nothing is ever scanned.',
    'Alerts for new or untrusted devices and unusual behaviour; network health check with plain-English advice; internet uptime and speed history.',
  ] },
  { version: '3.4.0', date: '2026-10-29', title: 'Coverage, tamper detection, Agent register', items: [
    'Coverage map showing each Agent’s field of view, blind spots and unwatched doors and windows.',
    'Tamper alerts: Agent moved, camera covered, unplugged, battery draining fast, unexpectedly offline.',
    'Agent register: hardware, mission history, uptime, calibration and maintenance notes.',
  ] },
  { version: '3.3.0', date: '2026-10-29', title: 'Correlation and pattern of life', items: [
    'Editable correlation rules (for example: door, then hall motion, then a known phone within 60 s = ARRIVAL).',
    'Pattern-of-life baseline over two weeks; unusual activity goes to Triage with a reason and a confidence %.',
  ] },
  { version: '3.2.0', date: '2026-10-29', title: 'Triage and incidents', items: [
    'Alert queue with severity, source, room and waiting time: acknowledge, escalate, dismiss with a reason, or convert to an incident.',
    'Incidents (INC-YYYY-NNNN) with status, assignee, notes, linked alerts, timeline and playback on the map.',
  ] },
  { version: '3.1.0', date: '2026-10-29', title: 'Professional redesign', items: [
    'New operations-console look: graphite and navy, IBM Plex fonts, classification banners, status bar.',
    'Configurable workspace (drag, resize, save layouts), Ctrl+K command palette and keyboard shortcuts.',
    'Architectural 3D map with an isometric view; sounds only for real alerts; plain sign-in screen.',
  ] },
];
