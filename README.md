# SENTINEL

**A private household security operations console that runs in your web browser.** Your Mac is **HQ**. Old phones and tablets become **Agents** that watch a room, look out of a window, guard a door or listen for loud noises. HQ brings it together like a professional operations floor: graded alerts, cases with reference numbers, a live 3D map of the house and grounds, a perimeter screen and weather station, a local AI Analyst, briefings, records and an audit trail.

Open it here: **<https://aaravshah11-tech.github.io/barcode-1-/hq/>** · one-page cheat sheet: **[Operator’s Quick Reference](https://aaravshah11-tech.github.io/barcode-1-/hq/quickref.html)** (print it and keep it by the desk).

- **Nothing to install.** HQ, Agents, your phone and the Wall Display are all web pages.
- **Everything stays at home,** encrypted, in your Mac’s browser. No cloud account, no subscription.
- **Only for you.** One operator (callsign **FIRST DESK**), PIN plus optional 2-step code, auto-lock, and every change written to a tamper-evident audit log.

> SENTINEL’s look is inspired by real operations rooms. It uses no real agency’s or TV show’s name, crest or branding.

---

## The rules SENTINEL always keeps

1. Camera and microphone data is processed on the Agent only. Never recorded, saved, streamed or sent — only events and numbers (e.g. “Person detected”, “62 dB”) leave a device. *(There is no live view.)*
2. Every active Agent shows a visible **SENTINEL AGENT ACTIVE** banner. No hidden or disguised modes.
3. Outside Agents must have privacy masks covering anything beyond your property before they can be armed.
4. The network health check only ever looks at your own home network.
5. The AI Analyst runs locally, uses read-only tools, cites evidence, and can’t change anything without your confirmation.
6. All data stays on HQ, encrypted at rest, and is deleted according to the retention policy.
7. No real agency or TV show names, logos or branding anywhere.

---

## Contents

1. [First start](#1-first-start)
2. [The screens](#2-the-screens)
3. [Agents](#3-agents)
4. [Alerts: how serious, and what to do](#4-alerts-how-serious-and-what-to-do)
5. [Perimeter and weather](#5-perimeter-and-weather)
6. [The Analyst](#6-the-analyst)
7. [Wall Display (iPad)](#7-wall-display-ipad)
8. [Your phone](#8-your-phone)
9. [Casework, Briefings and Records](#9-casework-briefings-and-records)
10. [Data, backups and privacy](#10-data-backups-and-privacy)
11. [Keyboard shortcuts](#11-keyboard-shortcuts)
12. [Honest limits](#12-honest-limits)
13. [Troubleshooting](#13-troubleshooting)
14. [For tinkerers](#14-for-tinkerers)

**What changed?** In HQ: **Administration › Settings › What’s new**.

---

## 1. First start

1. On your Mac, open the link above in **Chrome** (best for the Analyst and notifications).
2. SENTINEL runs its start-up checks, then asks you to **create the operator account**: your callsign (e.g. FIRST DESK) and a PIN. Write the PIN down somewhere safe.
3. Recommended: **Administration › Security › Turn on two-step sign-in** with an authenticator app.
4. **Administration › Settings › General › Location**: type your town (for weather, sunrise and sunset; only a rough position is used).
5. On the map press **Floor plan** (or `Ctrl K` › “Edit floor plan”): draw your rooms, then the **Outside** tab for the driveway, garden, garage and gates.
6. Press **Recruit** (top bar) to add your first Agent — see [Agents](#3-agents).
7. Keep HQ open, the Mac plugged in and awake. Agents only report while HQ is open. Turn on **On Watch** (top bar) when you want the screen kept awake and notifications from Advisory up.

---

## 2. The screens

| Key | Screen | What it’s for |
|---|---|---|
| 1 | **Operations Floor** | Current Picture, Triage summary, 3D map, Agent fleet, Perimeter, 24-hour Activity Timeline (drag to replay), Ask the Analyst. Layouts: Day, Night watch, Wall. |
| 2 | **Situation Room** | The full 3D house and grounds: camera presets, roof and X-ray views, coverage cones, a suggestion for your next Agent. |
| 3 | **Triage** | Every alert that needs a decision. Alert load card, snoozes and the daily digest at the top. |
| 4 | **Casework** | Incidents (INC-2026-0001): status, notes, links, documents, timeline, playback on the map, evidence export. |
| 5 | **Perimeter** | Front / garden / garage today, front-door visits, doors left open, weather station and rain radar. |
| 6 | **Agents** | Registry (health, battery, signal, version, bulk actions, day/night profiles) and Coverage. |
| 7 | **Network** | Your own devices, health check, internet history. |
| 8 | **Analyst** | Ask questions, Current Picture, morning SITREP, plain-English log search, model set-up. |
| 9 | **Briefings** | SITREP, weekly PDF report, report builder. |
| — | **Records** | Search (saved searches, export), Operator notes, Audit log. |
| — | **Administration** | Settings, Rules and patterns (correlation, grading, pattern of life), Security, Data and backups. |

The top strip always shows your callsign, the **Alert State**, HQ health, Agents online, unread alerts and the time. The bars at the very top and bottom change colour with the Alert State.

---

## 3. Agents

**Recruit:** top bar › **Recruit** › scan the QR code with the old phone › tap the link › allow camera/microphone if asked. It appears in Agents a few seconds later; pick its mission. Keep it on a charger.

| Mission | Uses | Reports |
|---|---|---|
| **MOTION WATCH** | camera (indoors) | “Motion detected” |
| **PERIMETER WATCH** | camera, looking out of a window | “Person / Vehicle / Animal detected (front)” |
| **DOOR TRIPWIRE** | motion sensors (stick it to a door) | “Door opened / closed” |
| **SOUND LEVEL** | microphone | “Loud sound: 82 dB” |
| **LIGHT CHECK** | camera brightness | “Lights on / off” |
| **DOOR PANEL** | a big button | “Door panel pressed” |
| **INTEL SCREEN** | — | turns the phone into a small wall screen |
| **STANDBY** | — | nothing |

**On the Agent:** after a minute the screen goes near-black (it moves now and then so nothing burns in) with the codename, mission, battery, signal and clock. **Tap to wake** for the last reports and **Identify**. The **SENTINEL AGENT ACTIVE** banner is always shown. If HQ can’t be reached for a minute it shows **HQ OFFLINE – STANDING BY**, switches its camera/microphone off, retries every 30 seconds and carries on by itself when HQ is back.

**PERIMETER WATCH setup wizard** (runs on the phone): window tips → mounting → which area it watches → **privacy masks** (tap every square that isn’t yours — they are blacked out before anything looks at the picture; tick “Everything that isn’t masked is my own property”) → walk test → **Arm**. Until you arm it, it can’t raise any alert, and HQ can’t arm it for you. Object recognition runs on the phone (bundled COCO-SSD); on a phone too slow for it, it falls back to “movement only” and says so.

**Registry** (Agents › Registry): tick Agents for **bulk** mission changes, **Identify** (flash and beep) or **Update** (reload the newest version). Open an Agent for battery history, recent reports, notes and a **day/night profile** (e.g. PERIMETER WATCH after sunset, STANDBY by day). SENTINEL warns when an Agent hasn’t reported for 15 minutes and writes a weekly fleet health summary.

---

## 4. Alerts: how serious, and what to do

| Grade | Means | Sound / notification |
|---|---|---|
| **Info** | For the record | none; doesn’t count as waiting |
| **Advisory** | Worth a look | one soft tone |
| **Alert** | Act now | two-tone + notification |
| **Critical** | Emergency (PANIC, LOCKDOWN) | repeats until acknowledged, even in quiet hours |

**Alert States:** HOME (activity is logged), AWAY (any activity is an intrusion), NIGHT (Agents “armed at night” alarm, bedrooms don’t), LOCKDOWN (everything armed). SENTINEL suggests a change when it fits (late evening → NIGHT).

**Grading:** before an alert reaches Triage, SENTINEL grades it by context — what was seen (an animal is Info; someone at the front while you’re home is an Advisory “probably a visitor”; a person in the garden at night is an Alert), the wind (outside movement in a gale is lowered), and what is normal for that hour. Add your own rules in **Administration › Rules and patterns › Grading rules** (e.g. “Animal · Garden · NIGHT → log only”) and try them out with **Try it**. Critical alerts can never be lowered.

**In Triage:** `A` acknowledge · `E` escalate · `D` dismiss (with a reason) · `I` open an incident · `S` snooze repeats (Agent, alert or kind; 15 min to 07:00). The **Alert load** card shows alerts a day, the false-alarm rate and which source is noisiest, with advice. A **daily digest** arrives at 08:00 (change it in Settings › Alerts). **Quiet hours** (default 23:00–07:00): only Critical makes a sound or notification.

**Notifications:** Settings › Alerts › Turn on notifications. They appear while SENTINEL is open (a background tab is fine on the Mac).

---

## 5. Perimeter and weather

The **Perimeter** screen shows the front / driveway, garden and garage / shed: today’s people, vehicles, animals and door openings, which Agents watch each area, and whether they are armed. **Front door · today** groups people seen at the front into visits: *Visitor* (the door was answered), *Caller* (rang the door panel, no answer), *Possible delivery or passer-by*, or *Lingering* (5 minutes or more — raises an Advisory). A garage or shed door left open for 15 minutes (you choose) raises an Advisory, or an Alert after dark or when AWAY/NIGHT.

The **weather station** (Open-Meteo): temperature, wind and gusts with direction, rain due, humidity, sunrise/sunset, a 12-hour outlook and a **RainViewer** rain radar on an OpenStreetMap map. UK weather warnings: the Met Office’s feed can’t be read by a web page, so there is a link to their warnings page.

---

## 6. The Analyst

A language model on **your own Mac** (Ollama) that reads SENTINEL’s records and answers in plain British English. It only has read-only tools, every fact ends with its evidence (ALT-000412, INC-2026-0003, EVT-5531 — click to see it), unknown references are marked *unverified*, and anything it suggests (“Switch to NIGHT”) is a button **you** press. It writes the **Current Picture** every 15 minutes and a **morning SITREP**, explains unusual-activity alerts (Triage › Explain), summarises cases (Casework › Summarise) and gives tuning advice.

**Set up once** (Analyst › Set up shows the same steps):

1. Install **Ollama** from ollama.com and open it once.
2. In **Terminal**: `ollama pull llama3.1:8b` (8 GB Mac: `llama3.2:3b`), then
   `launchctl setenv OLLAMA_ORIGINS "https://aaravshah11-tech.github.io"` and restart Ollama.
3. Use **Chrome**; if it asks to let the site reach this device / the local network, choose **Allow**.
4. In the Analyst screen tick **Use the local Analyst model**, **Save**, **Check connection**.

After a Mac restart run the `launchctl` line again. Without a model, SENTINEL still writes clearly-marked **automatic** summaries, and the plain-English **log search** (“people at the front yesterday”) always works.

---

## 7. Wall Display (iPad)

**Administration › Settings › Phones › Add a Wall Display** › scan the QR with the iPad › name it › **Link this display**. Then: Safari › Share › **Add to Home Screen** and open it from there; **Settings › Display & Brightness › Auto-Lock › Never**; and lock the iPad to SENTINEL with **Guided Access** (Settings › Accessibility › Guided Access; triple-click to start/stop). It rotates Situation → Perimeter → Agents → Timeline (tap to skip), stays on Situation while an Alert is waiting, needs no PIN, can’t change anything, and never receives HQ’s codes. Unlink it in the same place.

## 8. Your phone

**Settings › Phones › Link a phone**, scan, name it, sign in with your callsign and PIN. You get the full console (and alerts while it’s open on screen) from anywhere with internet.

---

## 9. Casework, Briefings and Records

- **Casework:** each incident has a status (Open → Investigating → Resolved → Closed), notes, **links** (another incident, or an outside reference such as a police crime number or an https link), **documents** (PDF or text, up to 1 MB, 5 per case — no photos, video or sound), a timeline, **Play back on map** and **Export evidence** (with a SHA-256 fingerprint).
- **Briefings:** the daily SITREP, a weekly PDF report and a report builder.
- **Records › Search:** words, kind, level, area and dates — or plain English. **Save this search** keeps it (dates move with today); export results as CSV or JSON. **Operator notes** and the **Audit log** are next to it.

---

## 10. Data, backups and privacy

Everything HQ saves is encrypted (AES-256) in this browser on this Mac. **Administration › Data and backups**: nightly encrypted backups (each one test-restored), **Back up now**, and **Download encrypted backup file** (sealed with your own password — needed to move to another computer). How long things are kept: **Retention** on the same screen. Unencrypted backups are no longer offered.

---

## 11. Keyboard shortcuts

`1`–`9` screens · `Ctrl K` / `⌘K` find or do anything · `?` all shortcuts · `Shift L` lock · `` ` `` terminal · `M` map 3D/plan · `Shift E` edit the layout · `↑ ↓` / `J K` choose an alert · `A E D I S` acknowledge / escalate / dismiss / incident / snooze · `Esc` close.

---

## 12. Honest limits

You asked for SENTINEL to stay **web-only** (no program installed on the Mac). That means:

- **HQ guards only while its tab is open** on a Mac that’s awake. On Watch keeps the *screen* awake; a web page can’t stop the Mac sleeping by itself — set macOS to keep the display on and leave the lid open.
- **No push notifications** to your phone when SENTINEL isn’t open on it, and no macOS notifications with the browser closed (both need a server).
- **No Wi-Fi / port scanning** — the network register uses SENTINEL’s own devices, your entries and your router’s device list.
- Agents and phones find HQ through PeerJS’s free matchmaking server (it never sees your data, which is encrypted end to end).
- Built as plain JavaScript modules with Three.js — not React/TypeScript/React Three Fiber — because GitHub Pages serves files as they are, with no build step.
- The house builder draws rooms as shapes (not individual walls) plus an Outside tab and version history.
- The Analyst needs Ollama and Chrome on the Mac; Safari blocks a website from talking to a program on the same computer.
- Met Office warnings are a link (their feed can’t be read by a web page). Rain radar depends on RainViewer’s free service.
- Object recognition on very old phones may be too slow; PERIMETER WATCH then reports “movement only”.
- “Camera covered” tamper detection can mistake a completely dark room for a covered lens.

---

## 13. Troubleshooting

| Problem | Fix |
|---|---|
| Agent OFFLINE / “HQ OFFLINE – STANDING BY” | Is HQ open and the Mac awake? Agent on Wi-Fi and charging? It reconnects by itself. |
| Camera / microphone / motion “blocked” | Allow it for this site in the phone’s browser settings, then **Update** the Agent in Agents › Registry. |
| PERIMETER WATCH “NOT ARMED” | Finish the setup wizard on the phone (privacy masks + Arm). |
| Too many alerts | Triage › Alert load card advice; snooze; a grading rule; lower sensitivity or add ignore zones. |
| No notifications | Settings › Alerts › Turn on notifications; check quiet hours. |
| Analyst “not reachable” | Ollama open? `OLLAMA_ORIGINS` set (again after a restart)? Using Chrome? |
| Wall Display “isn’t linked” | It was unlinked at HQ — add it again with a new QR code. |
| 2-step code refused | Set the phone’s clock to automatic; each code works once. |
| Forgot the PIN | Restore an encrypted backup file with its password on a fresh browser, or clear this site’s data and start again. |

---

## 14. For tinkerers

```
hq/                HQ console (index.html), phone console (remote.html), wall.html, quickref.html
  brain/           HQ's "server", running inside the HQ page
    hq.js  api.js  auth.js  store.js  host.js           Agents, requests + audit, sign-in, encrypted storage, links
    ops.js         triage, grading, snooze, digest, incidents, links, attachments
    analytics.js   correlation rules, pattern of life    tamper.js  network.js  reports.js  resilience.js
    fleet.js       registry health, bulk actions, day/night profiles
    perimeter.js   garage left open, lingering, visits   analyst.js  the local Analyst (Ollama)   weather.js
  views/           Triage, Casework, Perimeter, Registry, Coverage, Network, Analyst, Briefings, Records, Admin…
  app.js  floor.js map3d.js builder.js  alerts.js  wall.js
agent/             Agent page, missions/ (perimeter.js …), lib/ (camera, motion, tamper, perimeter-core, detector)
shared/            pure logic, unit tested: triage, grading, fatigue, correlate, baseline, coverage, perimeter,
                   fleet, analyst, weather, missions, report + pdf, link (message chunking) …
vendor/            Three.js, PeerJS, QR, IBM Plex, TensorFlow.js + COCO-SSD model (no CDN, no build step)
tests/unit/        npm test          tests/e2e/   npm run test:e2e (real Chromium, fake camera/mic/sensors)
DESIGN.md · docs/AUDIT.md · docs/mockups/
```

`npm ci` once, then `npm test` and `npm run test:e2e`. Add a changelog entry in `shared/changelog.js` for every update.

**Rollback to before v3:** commit `56b55fe` (see DESIGN.md › Rollback). **HomeBase** (the old app) is on the `homebase-archive` branch.
