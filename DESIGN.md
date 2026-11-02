# SENTINEL v3 — design document: "The Ops Floor"

Status: **built** (SENTINEL 4.0, phases 1–10). Decisions taken: emblem **C Meridian**; architecture **web-only** (see §8 — the operator chose to keep everything in the browser).
Mockups: `docs/mockups/ops-floor.html` (+ `.png`) and `docs/mockups/logos.html` (+ `.png`). Audit: `docs/AUDIT.md`.

---

## 1. Feeling

The operations floor of a modern domestic intelligence headquarters: a dark room, glass partitions, a wall of screens. Calm, cold, expensive, serious. Inspiration only — **no real agency or TV-show names, logos or branding anywhere**; all branding is SENTINEL's own.

Principles: dark glass · cool desaturated palette · colour is information, never decoration · restraint (hairlines, small uppercase labels, big clear numbers) · data-dense but calm · quiet motion (200–300 ms ease-out, numbers count up once) · authority.

Removed for good: neon, glitch, scanlines, typewriter text, fingerprint/retina scans, XP/ranks/achievements, self-destruct joke, game sounds. Old spy games stay archived as a disabled plug-in, hidden from navigation.

## 2. Design tokens (single source: `src/ui/tokens.css` + `tokens.ts`)

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#070B12` | page background |
| `--bg-raised` | `#0C121C` | bars, strips, table headers |
| `--bg-panel` | `#111927` | solid panels, inputs |
| `--glass` | `rgba(20,30,46,0.55)` + `backdrop-filter: blur(14px)` | panels |
| `--glass-edge` | `1px rgba(140,170,210,0.10)` | panel borders, hairlines |
| `--text-1` | `#E6ECF3` | primary text |
| `--text-2` | `#9AA8B8` | secondary, labels |
| `--text-3` | `#5F6E80` | muted, axis ticks |
| `--accent` | `#6FA8DC` | selection, focus, system marks (sparingly) |
| `--nominal` | `#4FA37A` | healthy / online |
| `--advisory` | `#C9A227` | advisory |
| `--alert` | `#D9822B` | alert |
| `--critical` | `#D64545` | critical only |
| `--offline` | `#4A5565` | offline / unknown |

Rules: no pure white, no neon, no saturated colour except a genuine Critical. Status is **never colour alone** — always a word or icon as well (e.g. `ALERT` badge, "OFFLINE").

Spacing scale 4/8/12/16/24/32 px · radius 4–6 px · hairlines 1 px · shadows none (glass + edge instead).

## 3. Typography (self-hosted, works offline)

- Interface: **IBM Plex Sans** 400 / 500 / 600 (already vendored).
- Data, timestamps, IDs, coordinates: **IBM Plex Mono**, tabular numbers.
- Labels: 11 px, uppercase, letter-spacing 0.08em, `--text-2`.
- Key figures: 32–48 px, light weight (300 — to be added to the vendored set), tabular.
- Body 13–14 px; tables 12.5 px.

## 4. Signature elements

- **Classification bars** top and bottom of every screen: `SENTINEL // OFFICIAL – HOUSEHOLD // FIRST DESK`. Bar colour follows the Alert State (HOME slate · AWAY steel · NIGHT deep blue · LOCKDOWN dark red), with the state also written in the status strip. Wall Display: `… // WALL DISPLAY – READ ONLY`.
- **Status strip**: callsign FIRST DESK · Alert State · HQ health (+ ON WATCH) · Agents online `6/7` · unread alerts · local time and UTC (mono, seconds) · session timer · ⌘K.
- **References everywhere**: ALT-000412, INC-2026-0042, SITREP-2026-11-02, RPT-2026-W45, AGT-05.
- **Emblem**: three options in `docs/mockups/logos.png` — **A Aperture** (abstract eye), **B Beam** (lighthouse beam), **C Meridian** (instrument reticle). My recommendation: **C Meridian** (cleanest at 16 px, most "system"); A is the safest second.
- **Boot / sign-in**: near-empty dark screen, emblem, "SENTINEL", one line of status checks fading in one after another (Storage · Agents link · Analyst · Weather), then username + password/PIN (+ 6-digit code if 2FA). Footer: "Access to this system is logged."
- **Sound**: Advisory = one soft low tone; Alert/Critical = a two-tone, Critical repeats until acknowledged. Volume + mute. Nothing for normal activity.

## 5. App structure

Slim left rail (icons; label on hover), global ⌘K palette (open any screen, find any Agent / incident / event, run any action), `?` shortcut overlay, shortcuts in every tooltip.

1. **Operations Floor** (default) · 2. **Situation Room** (full 3D) · 3. **Triage** · 4. **Casework** · 5. **Perimeter** · 6. **Agents** · 7. **Network** · 8. **Analyst** · 9. **Briefings** · 10. **Records** (+ audit log) · 11. **Administration** (settings, house builder, alert rules, retention, backups, system health).

Single operator: one account (FIRST DESK) with full rights, 2FA, auto-lock, audit log. Plus a read-only **Wall Display** pairing for the iPad.

## 6. Operations Floor (see mockup)

12-column grid of frosted panels:

- **Centre (~50%)**: compact live 3D of house + grounds, slow idle rotation, snaps to where activity happens. Camera presets in the corner.
- **Top-left · Current Picture**: Alert State (large), Analyst one-liner citing evidence, last significant event, time since last alert.
- **Left · Triage**: open counts by severity (Critical / Alert / Advisory / Info), 5 newest, clickable, waiting time.
- **Right · Agent Fleet**: one row per Agent (reference + codename, room, mission, battery bar, signal, status dot + word); problems float to the top.
- **Right-lower · Perimeter**: front/driveway, garden, garage/shed status + mini Met readout.
- **Bottom · Activity Timeline**: 24 h, lanes Inside / Front / Garden / Garage / Network; hover for detail, drag to scrub, the 3D view follows the scrubber.
- **Bottom-right · Ask the Analyst**: one input line, opens the Analyst panel.

Layouts saved per device: **Day**, **Night watch**, **Wall**. Laptop: the side columns narrow. **Phone**: a designed stacked-card layout (Current Picture → Triage → Fleet → Perimeter → Timeline), not a squashed desktop.

## 7. Components (one library, built on the tokens)

Shell (rail, classification bar, status strip, palette, shortcut overlay) · GlassPanel · Button (primary / secondary / ghost / danger) · Badge (severity + state, always with text) · StatusDot (+ label) · DataTable (sortable, sticky header, keyboard rows, virtualised for months of events) · KeyFigure (count-up once) · Timeline (lanes, scrubber) · Charts (bar, line, sparkline — one axis per chart, styled to match) · Modal / Sheet · Tabs / Segmented · Form fields · Toast · Empty states · Skeleton loading.

## 8. Architecture decision — outcome: web-only

The operator chose **“keep this only on the web”**. HQ stays a browser page (no Mac service, no React build). On Watch keeps the screen awake with the Wake Lock API; notifications work while a SENTINEL tab is open; the Analyst talks to Ollama directly from Chrome (`OLLAMA_ORIGINS`). The options below were the proposal at the time.

### The original proposal

The brief asks to "keep the existing Node.js HQ server, SQLite and WebSockets", but HQ currently runs as a web page (see AUDIT.md). Several v3 features **cannot** work from a browser tab:

| Feature | Needs |
|---|---|
| On Watch (stop the Mac sleeping via `caffeinate`) | a program on the Mac |
| Web push to your phone | a server to send pushes |
| Native macOS notifications while no tab is open | a program on the Mac |
| Analyst via Ollama (no browser security workarounds) | a local service to talk to Ollama |
| HQ keeps running when the browser is closed | a program on the Mac |
| Own-network discovery (only your network) | a program on the Mac |

**Recommendation:** bring back a **local HQ service on the Mac** (Node.js, started automatically at login), reusing today's brain modules — they already run in Node in the tests. It serves the new React app over HTTPS on your home network (mkcert), stores data in **SQLite, encrypted**, talks to Agents over **WebSockets** on Wi-Fi (no third-party matchmaking server), and to your phone at home or via Tailscale. Your existing data is imported once from the browser (export → import), nothing lost.

Front end: **React + TypeScript + Vite**, **React Three Fiber** for 3D, a small chart library styled to the tokens, Framer Motion only for subtle transitions. Agents stay PWAs (Wake Lock, auto-reconnect, offline standby, "Update available" pushed from HQ).

Cost to you: a one-time setup with a few copy-and-paste Terminal commands (I'll give each one exactly), after which HQ starts by itself.

Alternative (not recommended): keep HQ browser-only and drop On Watch, phone push, and reliable always-on monitoring.

## 9. Other points to confirm

1. **Roles**: simplify to one account + Wall Display. The multi-user code from v2 is removed (audit, 2FA and auto-lock stay).
2. **Network**: with a local service, the register can also *passively* list devices your Mac already sees (its ARP table / Bonjour) — your own network only, no port scanning. Router import stays.
3. **Weather warnings / radar**: Open-Meteo for weather (free, no key). UK warnings: I'll check the Met Office's free public warnings feed in Phase 6; rain radar: RainViewer's free tiles if their terms allow. I'll report what's possible.
4. **Object classification on old phones** (COCO-SSD in TensorFlow.js) may be slow on very old devices; the PERIMETER WATCH mission will fall back to motion-only with a clear label if a phone can't keep up.
5. **Analyst model**: chosen in Phase 7 after you tell me your Mac's memory (Apple menu › About This Mac).

## 10. Build order

Phases 1–10 exactly as in the brief, stopping after each with: what changed (plain English), a test checklist for HQ / phones / iPad, compromises, and a commit.

## Rollback

Before v3: commit `56b55fe` ("SENTINEL redesign part 9: README…"). To mark it on GitHub: repository › **Releases** › **Draft a new release** › *Choose a tag* › type `pre-v3` › *Target* › **Recent commits** › pick `56b55fe` › **Publish release**. To go back later, ask me to restore `pre-v3`.
