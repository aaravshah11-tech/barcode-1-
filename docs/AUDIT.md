# SENTINEL — codebase audit before v3

*Rollback point:* commit `56b55fe` on branch `claude/elegant-keller-rv8z5c` (the last commit before v3 work). A `pre-v3` tag was created but could not be pushed from the build session — add it on GitHub (see DESIGN.md › Rollback).

## How SENTINEL works today (important)

The brief assumes "the existing Node.js HQ server, SQLite and WebSockets". **That server was retired** in an earlier upgrade (it is archived on the `sentinel-server-archive` branch). Today:

- **HQ is a web page** (GitHub Pages). Its "server" — the brain that grades alerts, keeps the log, talks to Agents — runs **inside the HQ browser tab**.
- Data is kept in that browser (IndexedDB + localStorage), **encrypted** with AES-256.
- Agents and phones connect **peer-to-peer (WebRTC via PeerJS)**, found through PeerJS's free public matchmaking server. The data itself is encrypted end to end.
- No build step: plain JavaScript modules, Three.js for 3D.

This matters because several v3 features need something running **on the Mac itself**, outside a browser tab — see DESIGN.md › Architecture decision.

## Keep (works well, tested)

| Area | Where | Notes |
|---|---|---|
| Alert triage + incidents | `hq/brain/ops.js`, `shared/triage.js` | References (ALT-/INC-), merge of repeats, status flow, timeline, playback window. |
| Correlation engine | `shared/correlate.js`, `hq/brain/analytics.js` | Editable ordered/unordered sequences, dry-run testing. Extend to outside zones and classes. |
| Pattern of life | `shared/baseline.js` | 14-day hour-by-hour baseline per place with confidence %. |
| Coverage geometry | `shared/coverage.js` | Fields of view, blind spots, exterior entries. Reuse under the new 3D. |
| Tamper detection | `agent/lib/tamper-core.js`, `hq/brain/tamper.js` | Moved, covered, unplugged, drain, offline. |
| Network register + health | `shared/assets.js`, `hq/brain/network.js` | MAC maker lookup, router-list import, health advice, internet history. |
| Reports + PDF writer | `shared/report.js`, `shared/pdf.js` | No-library PDF with banners and charts. Restyle only. |
| Audit chain, TOTP, encryption | `shared/audit.js`, `shared/totp.js`, `shared/vault.js` | Sound; keep the logic. |
| Missions + sensor cores | `agent/missions/*`, `agent/lib/motion-core.js`, `door-core.js` | Detection logic is solid; screens need redesign. |
| Signed orders to Agents | `shared/crypto.js`, `shared/canonical.js` | HMAC-signed, replay-protected commands. |
| House data model | `shared/house.js` | Rooms, openings, fixtures, floors. Will be extended (walls, exterior), with an importer from the current format. |
| Tests | `tests/unit` (104), `tests/e2e` (21 browser files) | Keep and extend. |

## Rewrite

- **The whole HQ front end**: `hq/app.js` (1,100+ lines doing shell, panels, map and events at once), `hq/views/*`, `hq/dashboard.css`, `hq/workspace.js`, `hq/palette.js`. Hand-built HTML strings, no components, no types — hard to keep consistent.
- **3D**: `hq/map3d.js` (Three.js, hand-written) → React Three Fiber, new architectural look, exterior, cones, overlays.
- **House builder**: `hq/builder.js` draws rooms as polygons, not walls → new wall-based editor with exterior, trace, versions.
- **Agent screens**: `agent/agent.js` + `agent.css` → OLED standby, wake view, HQ-offline standby, setup wizard.
- **Alert grading**: today it is "event level → severity". v3 needs a real rules engine (state, time, class, weather, pattern) with the new Info/Advisory/Alert/Critical scale.
- **Access control**: built for several users with roles; v3 is single-operator. Simplify to one account (FIRST DESK) + read-only Wall Display.

## Bugs, security issues and mess found

1. **Role checks on the HQ computer can be bypassed.** The brain runs in the same tab as the screen, so anyone at the HQ computer with developer tools could skip checks. Phones *are* properly checked. Fixed naturally if the brain moves into a real HQ service.
2. **Third-party matchmaking server.** Connections are set up through `0.peerjs.com`. It never sees your data (encrypted), but it sees that devices connect, and SENTINEL depends on it being up.
3. **Unencrypted backup still offered.** Settings › General › Backup downloads a plain JSON copy of everything, bypassing the encrypted backup in Data. Should be removed or encrypted.
4. **Audit chain can be recomputed** by someone with full access to the browser's stored data (it detects casual edits, not a determined attacker). Fix: sign entries with a key held by the HQ service, and keep periodic signed exports.
5. **Encryption key lives in the same browser profile** as the data. Better: key held by the HQ service, optionally unlocked by your password at start-up.
6. **Monitoring stops whenever the tab closes or the Mac sleeps**, with no "keep awake" option. (v3's On Watch mode.)
7. **No push notifications to your phone** — a browser-only HQ can't send web push (it needs a server).
8. **"Camera covered" can false-trigger** in a completely dark room (no light at all looks like a covered lens). Needs light-level context.
9. **Leftovers from older versions**: `shared/boot.js` (no-op), the `fx` effects setting still threaded through settings and Agent config, theme commands in `shared/command.js`, `scripts/make-icons.cjs` only.
10. **Duplicate constants**: the classification text is defined in both `shared/ui.js` and `shared/report.js`.
11. **Slow test**: `tests/e2e/data.cjs` waits ~75 s for the phone's "HQ unreachable" banner.
12. **Analyst, Records, Perimeter, Wall Display, PERIMETER WATCH, object classification** don't exist yet (new in v3).

None of these put your data at risk today; items 1–5 are the ones worth fixing as part of v3.

## Outcome in v4.0 (web-only)

- **Fixed:** 3 (unencrypted backup removed — only password-sealed backup files), 10 (classification text now lives in `shared/brand.js`), 12 (Analyst, Records search, Perimeter, Wall Display, PERIMETER WATCH and object recognition built). Single-operator model in place.
- **Also fixed:** messages over ~16 KB were silently dropped by the connection library (it broke the INTEL SCREEN); big messages are now sent in pieces. LIVE VIEW removed (it streamed camera pictures, against rule 1).
- **Accepted because HQ stays in the browser:** 1, 2, 4, 5, 6 (partly — On Watch keeps the screen awake), 7. See README › Honest limits.
- **Unchanged:** 8 (dark-room “covered”), 9 (the old `fx` setting is still passed around, harmlessly) and 11 (slow data test).
