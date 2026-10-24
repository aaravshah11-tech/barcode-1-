# 🏠 HomeBase

One app, several tools, on your **phone** (scanning, tapping, motion) and your **computer** (big dashboards, stats, editing, photos). Anything you do on one shows up live on the other.

| Tool | Phone | Computer |
|---|---|---|
| 📚 **Library** | Scan book barcodes, batch-scan a shelf, “Where is it?” | Cover grid/list, search, filters, stats |
| 📦 **Inventory** | Scan product barcodes or snap a photo, scan box QR labels | Search, filters, places, print QR labels |
| 🏆 **Sports** — Rugby, Cricket, Hockey | Big one-tap logging pad, match clock, undo | Live dashboard, scorecards, season stats, leaderboards, charts |
| 📸 **Match Photography** | Camera-clock sync screen, moment tagging, shot checklist, where-to-stand tips, settings card + sunset | Import a folder, auto-sort photos by moment, cull with the keyboard, export picks with captions + Lightroom XMP |
| ⛳ **Golf Swing** | Record swings with the motion sensors | Motion graphs, compare two swings, trends by club/result |
| ⚙️ **Settings** | Pair devices | House locations, teams & players, backup, CSV exports |

Your old **Shelf** books, rooms and pairing are moved into HomeBase automatically the first time it opens.

---

## 1. Put it online (free)

Phones only allow the camera and motion sensors on **https://** sites, so HomeBase must be online.

**GitHub Pages** (this repo is already set up for it):
1. On GitHub open **aaravshah11-tech/barcode-1-** › **Settings** › **Pages**.
2. **Source:** *Deploy from a branch*. **Branch:** `claude/elegant-keller-rv8z5c` (or `main` once merged), folder **/ (root)** › **Save**.
3. After 1–2 minutes it’s live at **https://aaravshah11-tech.github.io/barcode-1-/**

**Or Netlify** (drag and drop): download the repo as a ZIP (**Code › Download ZIP**), unzip, go to **https://app.netlify.com/drop** and drag the folder in. You get an `https://….netlify.app` address.

**Updating:** push to the branch; the site updates in a minute. On your phone, close and reopen HomeBase (tap **Update** if asked).

## 2. Install it on your phone

- **iPhone (Safari):** open the link › **Share** › **Add to Home Screen** › **Add**.
- **Android (Chrome):** open the link › **⋮** › **Install app**.
- **Computer (Chrome/Edge):** click the install icon in the address bar (optional).

## 3. Pair your phone and computer

There are two ways. You can start with Quick link and switch to Cloud sync later.

### Option A — Quick link (no setup, works today)
1. **Computer:** HomeBase › **Settings** › **Pairing** › **Quick link (no setup)**. A QR code appears.
2. **Phone:** point the normal Camera app at the QR code and tap the link (or Settings › Pairing › *This is my phone*).
3. Both show **Linked**.

Works while **both devices have HomeBase open**. Data travels through free public relays, encrypted with your pairing code.

### Option B — Cloud sync with Supabase (recommended: works any time, anywhere)
Supabase is a free online database. About 5 minutes, done once, on your computer:

1. Go to **https://supabase.com** › **Start your project** › sign up (free) › **New project**. Pick any name and a database password (save it somewhere), choose the region closest to you, free plan › **Create**. Wait ~2 minutes.
2. In the left menu open **SQL Editor** › **New query**. Open the file **`supabase/schema.sql`** from this repo (on GitHub: click it › **Raw** › select all › copy), paste it in, press **Run**. You should see “Success”.
3. Left menu › **Authentication** › **Sign In / Providers** (may be called *Providers*) › turn on **Allow anonymous sign-ins** › **Save**.
4. Left menu › **Project Settings** (cog) › **API** (or *Data API*). Copy the **Project URL** and the **anon public** key. *(Never use the `service_role` key.)*
5. **Computer:** HomeBase › **Settings** › **Pairing** › **Cloud sync** › paste both › **Connect & create my household**.
6. A QR code appears. **Phone:** scan it with the Camera app and open the link. Done — the badge says **Synced**.

- Works on any network, even when the other device is switched off.
- Each device also keeps its own copy, so everything works **offline**; changes upload when you’re back online.
- The QR code is effectively a password for your data — don’t share it. **New code** makes old QR codes stop working.
- To add another device (a tablet, a family member’s phone): show the QR again in Settings › Pairing.

## 4. Before a match: camera clock sync (Match Photography)

Your camera’s clock is never exactly right. HomeBase measures how far off it is so photos can be matched to the moments you tag.

1. **Phone:** Sports › 📸 Match Photography › **Clock sync** (or the ⏱️ tile on the match page). A big clock and a changing QR code appear.
2. **Camera:** take **one photo of the phone screen**, filling most of the frame, in focus. (Do it before kick-off; once per camera per match.)
3. That’s it. When you import the photos on the computer, HomeBase finds that photo, reads the exact time from the QR code, compares it to the photo’s EXIF time and works out the offset (e.g. “Camera 1m 24s fast”).
   - If the QR can’t be read (blurry), use **Enter it by hand**: tap the clock photo and type the time shown (e.g. `14:32:07`).

**During the match (phone):**
- Open the match › **Tag moments**. Tap a shirt number (optional), then a moment: Try, Kick, Lineout, Scrum, Big tackle, Line break, Celebration, Team photo, Handshakes, Other.
- If you’re also logging stats on the Rugby pad, those events (tries, kicks, lineouts…) count as tags automatically.
- **Shot checklist** shows what you still haven’t got; **Where to stand** has tips per moment and an “I’m here” button.
- **Camera settings** has starting settings for action/blur/team photos, an ISO guide for sun/cloud/floodlights, and the sunset time for the venue.

**After the match (computer, Chrome or Edge):**
1. Match › **Import & auto-sort** › **Choose folder** (your card or the folder you copied the photos to). Photos are read on your computer — nothing is uploaded; only file names, times, tags and ratings are saved.
2. Check the clock result, adjust the **match window** (e.g. ±15 s) if needed. Photos are grouped like **“Try – #11 – 34:12”**.
3. **Cull:** click a photo, then use the keyboard: **← →** move · **1–5** stars · **P** pick · **X** reject · **U** unflag · **C** compare (burst) · **Esc** close. Picks/rejects auto-advance.
4. **Export picks:** choose a folder; HomeBase copies your picks into folders named by match and moment, writes **captions.csv**, and (optional) **XMP sidecars** with stars, keywords and caption for Lightroom (Lightroom reads sidecars for RAW files).
5. **Photo stats:** keeper %, moments you keep missing, best standing spots.

Photos with no EXIF time go in “No time info”. Safari/Firefox can import and cull but can’t write export folders (captions download still works).

## 5. Using the other tools

- **Library:** Scan (single), **Batch** (set the shelf once, then scan book after book), **Where is it?** (scan or search). Books not found online open a form where you can photograph the cover.
- **Inventory:** **Add / scan** a product barcode (Open Food Facts, UPCitemdb) or add with a photo + name. **Labels** prints QR labels for boxes/cupboards — scan one with your phone camera to see what’s inside.
- **House locations** (Settings): Room › Area (bookcase, cupboard, boxes…) › Shelf/Box. Shared by Library and Inventory; the last place you used is remembered.
- **Sports:** set up teams and players once in **Settings › Teams & players** (paste a squad as “11 Jo Brown” lines; a player can be in several teams). Then Sports › Rugby/Cricket/Hockey › **New match**.
  - **Rugby:** kick-off starts the clock; tap events, pick the player; yellow cards start a 10-minute sin-bin countdown; **Undo** removes the last event. Lengths are editable (2×40 down to 2×20 juniors).
  - **Cricket:** choose striker, non-striker and bowler, then tap each ball (0–6, wide, no ball, bye, leg bye, wicket). Strike changes automatically; new batter/bowler prompts appear when needed; target and required rate show in the chase.
  - **Hockey:** 4×15 by default; green (2 min) / yellow (5 min) suspensions count down.
  - Open the match on the computer for the **live dashboard**; **Season stats** has records, form, leaderboards and charts.
- **Golf Swing:** hold the phone in your glove/against the back of your hand or strap it to your forearm. Pick the club, tap **Ready** (iPhone asks to allow Motion — tap Allow), hold still until it says *Ready*, then swing. Tag the result (good/slice/hook/thin/fat/topped). Tempo, swing times, peak rotation and hand speed are **estimates** — great for comparing your own swings. On the computer: graphs, **Compare**, **Trends**.

**Outdoor mode:** tap the ◐ button (top right) for black-and-white high contrast and bigger text — handy in sun or rain.

## 6. Backup & export

Settings › **Backup**: one JSON file with everything (import it on any device; old Shelf backups work too), plus CSV spreadsheets per tool (books, inventory, matches, rugby/hockey events, cricket ball-by-ball, photo ratings and tags, golf swings).

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Camera or motion doesn’t work | Use the **https://** link. iPhone: Settings › Safari › Camera / Motion & Orientation Access › Allow. Android: tap 🔒 by the address › Permissions. |
| “Anonymous sign-ins are turned off” | Supabase › Authentication › Sign In / Providers › allow anonymous sign-ins. |
| “The database isn’t set up yet” | Run `supabase/schema.sql` in Supabase’s SQL Editor (step 3B.2). |
| “Pairing code not valid” | On the computer show a fresh QR (Settings › Pairing) and scan again. |
| Badge says “Offline · saved here” | Fine — changes upload automatically when you’re back online. |
| Photos all in “Not near a moment” | Check the camera clock offset (shoot the clock next time, or enter it by hand) and widen the match window. |
| Photo folder “needs reconnecting” | Click **Reconnect folder** (Chrome asks for permission again after a restart). |
| Golf: “No motion sensors found” | Use your phone, not a laptop. Try **demo swing** to see how it works. |

## 8. Privacy

- Everything is stored on your devices (IndexedDB). With Cloud sync it’s also in **your own** Supabase project; only your paired devices can read it (row-level security).
- Match photos never leave your computer — only tags, ratings and file names are stored.
- Lookups go to Open Library, Google Books, Open Food Facts, UPCitemdb and Open-Meteo (sunset); no account or key needed.

---

## For developers

Plain HTML/CSS/JavaScript ES modules — **no build step**. Run locally with `npx serve -l 8080 .` or `python3 -m http.server 8080` and open http://localhost:8080.

```
index.html · manifest.webmanifest · sw.js (offline) · netlify.toml
css/app.css            design system (light/dark/outdoor contrast)    css/tools.css  tool layouts
js/app.js              boot, router, start menu, header
js/tools.js            ★ tool registry — add a tool here
js/core/               store (generic synced records), db, ui, scanner, locations, people, charts, csv, migrate
js/sync/               manager · supabase (cloud) · relay (quick link)
js/settings/           locations, teams, pairing, backup
js/tools/<tool>/       library · inventory · sports · photo · golf
supabase/schema.sql    tables, row-level security, newest-wins trigger, realtime
scripts/update-sw.mjs  refreshes the offline file list (npm run sw)
tests/                 unit tests (*.test.mjs) + browser tests (e2e-*.cjs)
```

**Adding a tool:** create `js/tools/mytool/index.js` exporting `{ routes: { '': render, … }, nav: […], exports: [CSV exports] }`, add one line to `js/tools.js`, run `npm run sw`. Save data with `store.put('mycollection', {...})` — it syncs and backs up automatically.

**Data model:** every record lives in a named collection with `updatedAt`/`updatedBy`; deletes are tombstones; merging is newest-wins (same rule enforced by the Supabase trigger).

**Tests:**
```bash
npm install            # only needed for the database schema test (PGlite)
npm test               # unit tests: ISBN, lookups, scoring engines, photo matching, golf analysis, Supabase schema
npm run test:live      # real ISBN lookups (needs internet)
# Browser tests (Playwright): serve on :8080 first; sports/core tests also need MQTT test relays on :8888/:8889
node tests/e2e-library.cjs   node tests/e2e-inventory.cjs   node tests/e2e-sports.cjs
node tests/e2e-photo.cjs     node tests/e2e-golf.cjs        node tests/e2e-core.cjs
node tests/supabase-e2e.cjs  node tests/e2e-offline.cjs
python3 tests/make-photo-fixtures.py   # regenerates the sample JPEGs with EXIF times
```

Credits: Open Library, Google Books, Open Food Facts, UPCitemdb, Open-Meteo, html5-qrcode (ZXing), qrcode-generator, MQTT.js, supabase-js, exifr.
