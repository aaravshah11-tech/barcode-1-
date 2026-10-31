# SENTINEL

**A household security operations console that runs in your web browser.** Your computer is **HQ**. Old phones and tablets become **Agents** that watch for motion, guard a door, listen for loud noises, act as a door panel or a wall display. HQ brings it all together the way a professional security operations centre would: an alert triage queue, incidents with reference numbers, correlation rules, coverage maps, reports, access control and an audit trail.

Open it here: **<https://aaravshah11-tech.github.io/barcode-1-/hq/>**

- **Nothing to install.** HQ, Agents and your phone are all web pages.
- **Everything stays at home.** HQ keeps its data in your computer's browser, **encrypted**. No cloud account, no subscription.
- **Private by design.** Cameras and microphones are used *on the Agent only*. HQ receives events like "Motion detected" — never pictures, video or audio.
- **Yours only.** Nobody can see anything without signing in, and every sign-in and change is written to a tamper-evident audit log.

> SENTINEL takes its *style* from professional security operations software. It does not use the name, crest or branding of any real agency.

---

## Contents

1. [The screens at a glance](#1-the-screens-at-a-glance)
2. [First start](#2-first-start)
3. [Recruiting Agents](#3-recruiting-agents)
4. [Operations: the main screen](#4-operations-the-main-screen)
5. [Triage and incidents](#5-triage-and-incidents)
6. [Analysis: correlation rules and pattern of life](#6-analysis-correlation-rules-and-pattern-of-life)
7. [Coverage, tamper detection and the Agent register](#7-coverage-tamper-detection-and-the-agent-register)
8. [Network security](#8-network-security)
9. [Reports](#9-reports)
10. [Access control, audit log and shift log](#10-access-control-audit-log-and-shift-log)
11. [Data and resilience](#11-data-and-resilience)
12. [Your phone](#12-your-phone)
13. [Keyboard shortcuts](#13-keyboard-shortcuts)
14. [Privacy rules](#14-privacy-rules)
15. [What a browser can't do (honest limits)](#15-what-a-browser-cant-do-honest-limits)
16. [Troubleshooting](#16-troubleshooting)
17. [For tinkerers](#17-for-tinkerers)

**What's new?** Open **Settings › What's new** in HQ for the changelog of every update.

---

## 1. The screens at a glance

Every screen has a classification banner at the top and bottom (**SENTINEL // RESTRICTED – HOUSEHOLD**) and a status bar along the bottom: who is signed in, their role, session time, the alert state, UTC and local time, HQ health and how many Agents are online.

The rail on the left switches between screens (or press **1–9**):

| Screen | What it's for |
|---|---|
| **Operations** | The live picture: 3D site map, alert state, Agents, alert queue, event log, messages, network, situation. Panels can be moved, resized and saved as layouts. |
| **Triage** | Every alert that needs a decision. Acknowledge, escalate, dismiss (with a reason) or turn it into an incident. |
| **Incidents** | Cases with reference numbers (INC-2026-0042), status, assignee, notes, linked alerts, a timeline and playback on the map. |
| **Analysis** | Correlation rules and the household's pattern of life. |
| **Coverage** | What each Agent can see, blind spots, and outside doors/windows with no sensor. |
| **Agents** | The Agent register: hardware, mission history, uptime, calibration, tamper history, notes. |
| **Network** | Asset register of your home network, the health check, and internet history. |
| **Reports** | Today's SITREP, the report archive (PDF) and the report builder. |
| **Shift log** | Notes and handover notes for whoever takes over. |
| **Access** *(Director)* | Users and roles, sessions, two-step sign-in, the audit log. |
| **Data** *(Director)* | Encryption, backups, retention, evidence export, HQ downtime record. |

---

## 2. First start

1. On the computer that will be HQ (it should stay on at home), open **<https://aaravshah11-tech.github.io/barcode-1-/hq/>** in Chrome, Edge, Safari or Firefox.
2. **Create the Director account**: a username and a PIN or password (at least 4 characters; 6 or more is better). Only a salted hash is stored.
3. You're in. Keep this tab open — while it is open, HQ is guarding the house. Closing the screen lock (**Shift+L**) doesn't stop it.

**Try it:** press **Ctrl+K** (⌘K on a Mac) and type "away". The command palette finds *Set AWAY*. Press **?** to see every shortcut.

**Recommended next:** Settings › General › set your town (for weather and sunrise), then **Ctrl+K › Two-step sign-in** to protect your account with an authenticator app.

---

## 3. Recruiting Agents

1. On HQ press **Recruit** (top right). A QR code appears.
2. On the old phone, scan it with the camera. The Agent page opens and joins HQ in a couple of seconds.
3. The Agent appears in **Operations › Agents**. Click it to give it a mission:

| Mission | What it does |
|---|---|
| **Motion watch** | Spots movement with the camera. You can mark *ignore zones* (TVs, windows). |
| **Door tripwire** | Stick the phone on a door: it reports opened/closed using its motion sensor. |
| **Sound level** | Reports loud noises (as a number of decibels — no audio). |
| **Light check** | Notices lights being switched on or off. |
| **Door panel** | A big button visitors can press. |
| **Intel screen** | A read-only wall display of the situation. |

Drag an Agent from the list onto the **3D map** to place it in a room (draw your house first with **Floor plan**).

Every Agent always shows the banner **SENTINEL AGENT ACTIVE – [mission]** at the top of its screen. There is no hidden mode.

---

## 4. Operations: the main screen

- **Alert states** (top bar): **HOME** (activity is only logged), **AWAY** (any activity is an intrusion), **NIGHT** (Agents armed for night raise alerts) and **LOCKDOWN** (everything armed; Agents can sound an alarm). Every change is logged as *"Alert state: AWAY (by MUM) — reason"*.
- **3D map:** flat-shaded architectural model; rooms change colour only to show status. **Iso** gives an isometric view; **Replay** plays the day back; **Heatmap** shows the busiest rooms.
- **Edit layout:** drag a panel by its title bar, resize from its corner, **Save as…** to keep it (e.g. "Night watch"). Presets: *Standard*, *Map focus*, *Event review*. On a phone, panels stack in one column.
- Sounds only play for real alerts. **Panic** is always one hold away.

---

## 5. Triage and incidents

Alerts are raised when something needs a decision: activity while AWAY or at NIGHT, Panic, a failed sign-in, tamper, a new device on the network, an anomaly, a correlation rule. Each has a **severity** (LOW, MEDIUM, HIGH, CRITICAL), its source Agent, room, time, a plain-English reason, and how long it has been waiting. Repeats within a minute are merged (×2, ×3…).

**Try it:** set AWAY, wave at a Motion-watch Agent, then open **Triage**:

- **↑ ↓** choose, **A** acknowledge, **E** escalate, **D** dismiss (pick a reason: false alarm, household member, test…), **I** convert to an incident.
- In **Incidents**, move the case through **Open → Investigating → Resolved → Closed**, set the assignee, add notes, read the full timeline, and press **Play back on map** to watch just those minutes again.

---

## 6. Analysis: correlation rules and pattern of life

**Correlation rules** turn several signals into one conclusion. Example (included): *front door opens → hall motion → a known phone appears, within 60 s = **ARRIVAL (likely: Mum)***. Build your own with **New rule**: choose signals, rooms or Agents, a time window, which alert states it runs in, and whether the result is just logged or sent to Triage. **Test on last 7 days** shows how often it would have fired.

**Pattern of life** learns, over two weeks, when each room is normally active (weekdays and weekends separately). After a week it flags *unusual activity* (e.g. the kitchen at 03:00), *unusually busy* hours and *usual activity missing* — each with a reason and a **confidence %**, straight into Triage.

---

## 7. Coverage, tamper detection and the Agent register

- **Coverage:** each camera's field of view is drawn on the floor plan, with the % of every room watched. Rooms under 15% are **blind spots**; outside doors and windows with no sensor are listed as **not watched**. Turn a camera with ⟲ ⟳ and watch the numbers change.
- **Tamper detection:** an Agent reports if its phone is **moved** (picked up or turned) or its **camera is covered**; HQ notices if it's **unplugged**, its **battery drains fast**, or it goes **offline unexpectedly**. Each goes to Triage with an explanation (HIGH when the house is AWAY/NIGHT/LOCKDOWN).
- **Agents** (register): hardware (e.g. *Pixel 7 · Android 14 · Chrome*), mission history, location, uptime over 7 and 30 days, last calibration, last tamper and maintenance notes. **Mark calibrated now** records a check.

---

## 8. Network security

**SENTINEL never scans anything outside your home network — or inside it.** A web page can't look at your Wi-Fi, so the **asset register** is built from:

1. SENTINEL's own devices (HQ, Agents, linked phones) — listed automatically;
2. devices you add by hand;
3. **Import from router:** open your router's admin page (often `192.168.1.1`), copy its *attached devices* table and paste it. Names, IP and MAC addresses are read; the maker is looked up from the MAC; private (randomised) addresses are recognised.

New devices start **untrusted** and raise *New device on your network* alerts. Mark the ones you know as trusted, give them an owner (your phone's owner feeds the ARRIVAL rule). HQ also flags an Agent dropping from Wi-Fi to mobile data, and a linked phone used at an unusual hour.

The **health check** gives a score and plain-English advice (https, PIN length, two-step sign-in, auto-lock, unused phones, untrusted devices, smart-home gadgets) plus a short router checklist (WPA2/3, admin password, firmware, WPS, remote admin, UPnP, guest network). **Internet history** shows 30 days of uptime and response time, every outage and every speed test.

---

## 9. Reports

- **SITREP** (situation report): the last 24 hours in numbered paragraphs — situation, activity, alerts and incidents, analysis, equipment and network, actions. **Download PDF** or **Save to reports**.
- **Weekly report** (RPT-2026-W44): made automatically every Monday at 07:00 while HQ is open (and a SITREP every morning at 07:00), or press **Weekly report now**.
- **Report builder:** choose the period, sections, minimum severity, rooms and Agents → **Create report and download PDF** (RPT-2026-0001…).

Every PDF has the classification banner on every page, the reference and *Page X of Y*, key figures, charts (events per day, by room, alerts by severity) and tables. The PDF is made in your browser — nothing is uploaded.

---

## 10. Access control, audit log and shift log

**Roles** — checked by HQ on every request, from the HQ computer and from phones (never just a hidden button):

| Role | Can |
|---|---|
| **DIRECTOR** (you) | Everything: users, the audit log, backups, recruiting, data. |
| **OPERATOR** | Handle alerts and incidents, change the alert state, send messages, run Agents, make reports. |
| **OBSERVER** | Look at everything allowed, change nothing. |

SENTINEL is for your household only — you decide whether anyone else gets an account (**Access › Add user**).

- **Two-step sign-in:** **Ctrl+K › Two-step sign-in**, scan the QR code with any authenticator app, enter the 6-digit code. From then on sign-in asks for a code after the PIN. Each code works once.
- **Sessions:** **Access › Sessions** shows who is signed in and from where (*HQ computer*, *Phone "Mum's iPhone"*). End one, or all others. Idle sessions end after the auto-lock time; a phone is signed out the moment its session ends.
- **Audit log:** **Access › Audit log** lists every sign-in, change and *refused* attempt. Entries are chained by fingerprints (SHA-256), so if anyone edits or deletes one, the screen says **Audit log altered** and which entry. **Export with checksum** saves a CSV plus its SHA-256. PINs and codes are never written to it.
- **Shift log:** notes, and **handover notes** with an automatic summary (alert state, unhandled alerts, open incidents, offline Agents). The next person to sign in sees it and acknowledges it.

---

## 11. Data and resilience

*(Data screen, Director only)*

- **Encrypted at rest:** everything HQ saves — settings, event log, audit log, floor plans, backups — is sealed with **AES-256-GCM** using a key the browser keeps and won't let anyone copy out. Older data is converted automatically. Links to Agents and phones are encrypted too (HTTPS page, encrypted peer-to-peer connections).
- **Backups:** made automatically every night after 03:00 (the last 7 are kept) and **test-restored** straight away into a throw-away HQ to prove they work. **Back up now**, **Test again**, **Restore** (recorded in the audit log). **Download encrypted backup file…** seals a copy with a backup password you choose — keep it somewhere else; restore it on any computer with **Restore from a file…**.
- **Retention:** how long each kind of record is kept. Open alerts and anything in an active incident are always kept; the audit log is kept at least a year.
- **Evidence:** **Export evidence** (on an incident, or here) saves everything about it as one file with a SHA-256 fingerprint that is also written into the audit log. **Check an evidence file…** proves later that it hasn't been changed.
- **Watchdog:** HQ records every gap — closed, the computer asleep, a crash or power cut, or a freeze — and restarts itself if it freezes, loses its link for 10 minutes, or hits a burst of errors. Nothing is lost: everything is saved first.

---

## 12. Your phone

**Settings › Phones › Link a phone**, scan the QR code with your phone, then sign in with your username and PIN (and code, if two-step is on). Your phone sees the same console as HQ. If HQ can't be reached for about a minute, the phone shows **HQ UNREACHABLE since 21:14** with a sound and vibration (while the page is open).

Away from home it works over the internet by itself. If your network blocks that, a free [Tailscale](https://tailscale.com) link between your phone and the HQ computer works too.

---

## 13. Keyboard shortcuts

| Keys | Does |
|---|---|
| **Ctrl K** / **⌘K** | Command palette — jump anywhere, run anything |
| **1 – 9** | Switch screen |
| **?** | All shortcuts |
| **G** | Global intel (ISS, aircraft, earthquakes, ships) |
| **M** | Map: 3D / plan |
| **Shift E** | Edit the workspace layout |
| **Shift L** | Lock the console |
| **`** | Terminal |
| **V** (hold) | Push-to-talk voice command (if switched on) |
| **↑ ↓ / J K, A, E, D, I** | Triage: choose, acknowledge, escalate, dismiss, incident |
| **Esc** | Close a window |

Buttons show their shortcut when you hover over them.

---

## 14. Privacy rules

These are built in and covered by the automated tests:

1. **Camera and microphone data is processed on the Agent only.** No images, video or audio are recorded, saved or sent — only events such as "motion detected" or "72 dB". HQ throws away any long piece of data an Agent sends.
2. **Live view only on demand**, opened from HQ, logged, and the Agent shows a red **LIVE VIEW – HQ IS WATCHING THIS CAMERA** banner the whole time. Nothing is recorded.
3. **Every active Agent shows "SENTINEL AGENT ACTIVE – [mission]".** There is no hidden mode.
4. **Your data stays on your HQ computer**, encrypted. Network features never scan anything; they only use what SENTINEL sees, what you add, and what you copy from your own router.

Please only point cameras at your own home, and tell the people who live with you that SENTINEL is running.

---

## 15. What a browser can't do (honest limits)

- **No Wi-Fi or port scanning.** Web pages aren't allowed to, so the asset register uses SENTINEL's own devices, your entries and your router's device list.
- **HQ guards only while its tab is open** on a computer that's awake. The watchdog records every gap and phones warn you, but it can't wake a sleeping computer — set the computer to stay awake.
- **Encryption at rest** stops anyone reading HQ's stored data or backups, but the key lives in this browser on this computer. Use your computer's disk encryption (FileVault / BitLocker) and a computer password as well.
- **The audit log is tamper-*evident*:** it shows that something was changed, and where. Keep exported copies (with their checksum) somewhere else for proof.
- **Tamper "camera covered"** looks for a completely dark, flat picture — a fully dark room with no light at all can look the same.

---

## 16. Troubleshooting

| Problem | Fix |
|---|---|
| **"HQ is already open in another tab"** | Only one HQ per browser. Use the other tab, or close it and reload. |
| **Agent says it can't reach HQ** | Is the HQ tab open and the computer awake? The Agent retries by itself. |
| **Camera / microphone / motion "blocked"** | Allow it for this site in the phone's browser settings, then press **Reload** on the Agent's card in HQ. |
| **"Turn on move alerts" button on an iPhone Agent** | Tap it once to allow the motion sensor (needed for tamper "moved"). |
| **Two-step code refused** | Check the phone's clock is set automatically. Each code works once — wait for the next one. |
| **Too many motion alerts** | Lower the sensitivity, raise the cooldown, add ignore zones; or write a correlation rule and dismiss single motions as "expected activity". |
| **Forgot the PIN** | Without the PIN (and with no other Director) HQ can't be unlocked. Restore an encrypted backup file on a fresh browser with your backup password, or start fresh by clearing this site's data in the browser. |

---

## 17. For tinkerers

```
hq/                the HQ console (index.html) and the linked-phone console (remote.html)
  brain/           HQ's "server", running inside the HQ page:
    hq.js          Agents, events, alert states, signed orders      api.js     every request + role checks + audit
    auth.js        users, roles, sessions, two-step sign-in          store.js   encrypted storage
    ops.js         triage + incidents        analytics.js  rules + pattern of life     tamper.js
    network.js     asset register, health    reports.js    SITREP / weekly / custom    resilience.js
    host.js        PeerJS link to Agents and phones                  netmon.js / weather.js
  views/           Triage, Incidents, Analysis, Coverage, Agents, Network, Reports, Shift log, Access, Data
  app.js           the console frame: rail, workspace, status bar, palette
agent/             the Agent page and its missions/
shared/            logic shared by HQ, phones and Agents (pure functions, unit tested):
                   triage, correlate, baseline, coverage, assets, report + pdf, roles, totp, audit, vault…
vendor/            Three.js, PeerJS, QR code, IBM Plex fonts (no build step, no CDN)
tests/unit/        npm test           tests/e2e/   npm run test:e2e (real Chromium with fake camera, mic and sensors)
```

- `npm ci` once, then `npm test` (unit) and `npm run test:e2e` (browser tests; uses Playwright's Chromium).
- Add a changelog entry in `shared/changelog.js` for every update — it appears in **Settings › What's new**.

---

## HomeBase (the old app)

HomeBase was retired when SENTINEL arrived. Its full code is on the **`homebase-archive`** branch (`git checkout homebase-archive`).
