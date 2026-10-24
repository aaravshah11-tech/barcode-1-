# 🏠 HomeBase

One app, several tools, on your **phone** (scanning, tapping, motion) and your **computer** (big dashboards, stats, editing, photos). Anything you do on one shows up live on the other.

| Tool | Phone | Computer |
|---|---|---|
| 📚 **Library** | Scan book barcodes, batch-scan a shelf, “Where is it?” | Cover grid/list, search, filters, stats |
| 📦 **Inventory** | Scan product barcodes or snap a photo, scan box QR labels | Search, filters, places, print QR labels |
| 🥫 **Pantry** | Scan food as you put the shopping away, tap −1 when you use something, shared shopping list | Everything sorted by use-by date |
| 🧾 **Warranties & documents** | Photograph receipts and warranty cards | End dates, linked Inventory item, where the box is |
| 🏆 **Sports** — Rugby, Cricket, Hockey | Big one-tap logging pad, match clock, undo | Live dashboard, scorecards, season stats, leaderboards, charts |
| 📸 **Match Photography** | Camera-clock sync screen, moment tagging, shot checklist, where-to-stand tips, settings card + sunset | Import a folder, auto-sort photos by moment, cull with the keyboard, export picks with captions + Lightroom XMP |
| ⛳ **Golf Swing** | Record swings with the motion sensors, per-person calibration | Practice sessions, motion graphs, compare two swings, trends |
| 🔔 **Reminders** | Things lent out over 30 days, warranties and food running out, matches this week | Same |
| ⚙️ **Settings** | Pair devices, your name | House locations, teams & players, optional email sign-in, backup, CSV exports |

**Search everything** from the start menu: type (or press **/**) to find books, items, food, documents, rooms and boxes, matches, players and golfers in one go.

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

Works while **both devices have HomeBase open**. Data travels through several free public relays at once (two of them on the normal https port, so strict Wi-Fi and phone networks still get through), encrypted with your pairing code. Pairing usually takes a few seconds; the screen shows how many relays are connected. If it’s stuck on *Connecting…*, switch the phone between Wi-Fi and mobile data, or use Cloud sync (Option B), which always works.

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
- To add another device (a tablet, a family member’s phone): show the QR again in Settings › Pairing — or use email sign-in (below).
- **Already set up before this update?** Run `supabase/schema.sql` again (step 2). It’s safe to re-run and adds what names and email sign-in need.

### Names & email sign-in (optional)
- **Settings › You & sign-in › Your name** — works on every device, with or without cloud sync. Your name shows as “Added … by Mum” on books and items, and is offered as an owner/borrower.
- **Email sign-in** (needs cloud sync) lets a new phone or computer join with a 6-digit code instead of a QR code, and shows everyone’s name and email under *People in this household*. Your device keeps its account and data; nothing is lost.
- One-time Supabase setup so the email contains the code:
  1. **Authentication › Sign In / Providers › Email**: make sure it’s **enabled**.
  2. **Authentication › Emails** (Email Templates): in **Magic Link** and **Change Email Address**, add a line such as `Your HomeBase code: {{ .Token }}` › **Save**.
- **New device:** Settings › Pairing › **Cloud sync** › **Sign in with email** › paste the Project URL and key (same as the first device) › enter your email › type the code.
- The free Supabase email service sends only a few emails per hour — fine for a family. If codes stop arriving, wait an hour or connect your own email (SMTP) in Supabase.

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
3. **Cull:** click a photo, then use the keyboard: **← →** move · **1–5** stars · **P** pick · **X** reject · **U** unflag · **C** compare the **whole burst** side by side (up to 6; ← → move between them) · **Esc** close (first Esc leaves compare). Picks/rejects auto-advance. **RAW** files (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG…) show the camera’s full-size preview, and iPhone **HEIC** photos are converted in the browser.
4. **Export picks:** choose a folder; HomeBase copies your picks into folders named by match and moment, writes **captions.csv**, and (optional) **XMP sidecars** with stars, keywords and caption for Lightroom (Lightroom reads sidecars for RAW files). **Download as ZIP** gives the same folders in one file (big exports are split into parts under 4 GB).
5. **Photo stats:** keeper %, moments you keep missing, best standing spots.

Photos with no EXIF time go in “No time info”. Safari/Firefox can import and cull; they can’t write into folders, so they export as a ZIP instead.

## 5. Using the other tools

- **Library:** Scan (single), **Batch** (set the shelf once, then scan book after book), **Where is it?** (scan or search). Books not found online open a form where you can photograph the cover.
- **Inventory:** **Add / scan** a product barcode (Open Food Facts, UPCitemdb) or add with a photo + name. **Labels** prints QR labels for boxes/cupboards — scan one with your phone camera to see what’s inside.
- **House locations** (Settings): Room › Area (bookcase, cupboard, boxes…) › Shelf/Box. Shared by Library and Inventory; the last place you used is remembered.
- **Sports:** set up teams and players once in **Settings › Teams & players** (paste a squad as “11 Jo Brown” lines; a player can be in several teams). Then Sports › Rugby/Cricket/Hockey › **New match**.
  - **Line-ups (rugby & hockey):** tap **Choose starters** before kick-off. Substitutions only offer players on the field (off) and on the bench (on), and every player gets **minutes played** on the dashboard and season page.
  - **Rugby:** kick-off starts the clock; tap events, pick the player; after a **try** it asks *Conversion made / missed* with the last kicker already picked; yellow cards start a 10-minute sin-bin countdown; **Undo** removes the last event. Lengths are editable (2×40 down to 2×20 juniors).
  - **Cricket:** choose striker, non-striker and bowler, then tap each ball (0–6, wide, no ball, bye, leg bye, wicket). Strike changes automatically; new batter/bowler prompts appear when needed; target and required rate show in the chase. Run-outs and stumpings can happen off a **wide**, run-outs off a **no ball**. **Retire** marks a batter *retired hurt* (they can come back later) or *retired out* (counts as a wicket).
  - **Hockey:** 4×15 by default; green (2 min) / yellow (5 min) suspensions count down.
  - Open the match on the computer for the **live dashboard**; **Season stats** has records, form, leaderboards and charts.
- **Golf Swing:** hold the phone in your glove/against the back of your hand or strap it to your forearm. Pick the club, tap **Ready** (iPhone asks to allow Motion — tap Allow), hold still until it says *Ready*, then swing. Tag the result (good/slice/hook/thin/fat/topped). Tempo, swing times, peak rotation and hand speed are **estimates** — great for comparing your own swings. On the computer: graphs, **Compare**, **Trends**.
  - **Golfers:** add each person (name + height) and tap **Calibrate**: hold still for 3 seconds, then make 3 practice swings. Detection and hand speed are then tuned to them. Pick *Who’s swinging* on the record screen.
  - **Practice sessions:** swings are grouped automatically (a new session starts after 30 minutes without a swing, or tap *Start a new session*). Each session shows tempo consistency, a tempo chart and notes. Older swings are grouped the same way.
  - Impact is timed from the **jolt of hitting the ball** when the phone feels one, otherwise from the fastest rotation.
- **Pantry:** **Scan / add** a food barcode (same lookup as Inventory), pick fridge/freezer/cupboard and a use-by date (quick buttons: +3 days … +1 year). Next time you scan that product its name and usual shelf life fill in instantly, even offline. Tap **−1** when you use one; finishing something offers to add it to the **Shopping list**, which everyone in the house shares live. Scanning it back in ticks it off.
- **Warranties & documents:** **Add** a warranty, receipt, manual or insurance paper, photograph it, set the purchase date and tap *2 years from purchase* (etc.). Link it to an Inventory item and save **where the box is**. On an Inventory item, **Add warranty or receipt** fills all that in for you.
- **Reminders:** lent-out books/items over 30 days, warranties ending within 30 days, food past or near its date, and matches in the next week. The start menu shows a summary; **Hide 7 days** snoozes one on every device.

**Outdoor mode:** tap the ◐ button (top right) for black-and-white high contrast and bigger text — handy in sun or rain.

## 6. Backup & export

Settings › **Backup**: one JSON file with everything (import it on any device; old Shelf backups work too), plus CSV spreadsheets per tool (books, inventory, matches, rugby/hockey events, cricket ball-by-ball, photo ratings and tags, golf swings).

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Camera or motion doesn’t work | Use the **https://** link. iPhone: Settings › Safari › Camera / Motion & Orientation Access › Allow. Android: tap 🔒 by the address › Permissions. |
| “Anonymous sign-ins are turned off” | Supabase › Authentication › Sign In / Providers › allow anonymous sign-ins. |
| “The database isn’t set up yet” | Run `supabase/schema.sql` in Supabase’s SQL Editor (step 3B.2). |
| Quick link stuck on “Connecting…” | Your network is blocking the relays: switch the phone between Wi-Fi and mobile data, keep HomeBase open on both devices, or set up Cloud sync. |
| “Pairing code not valid” | On the computer show a fresh QR (Settings › Pairing) and scan again. |
| Badge says “Offline · saved here” | Fine — changes upload automatically when you’re back online. |
| Photos all in “Not near a moment” | Check the camera clock offset (shoot the clock next time, or enter it by hand) and widen the match window. |
| Photo folder “needs reconnecting” | Click **Reconnect folder** (Chrome asks for permission again after a restart). |
| Golf: “No motion sensors found” | Use your phone, not a laptop. Try **demo swing** to see how it works. |
| Golf: gentle swings aren’t detected | Golf › **Golfers** › **Calibrate** for that person. |
| Email code never arrives | Check spam; add `{{ .Token }}` to the Supabase email templates (see *Names & email sign-in*); the free email service is limited to a few per hour. |
| “That code is wrong or has expired” | Ask for a new code and use the newest email. |
| “The database needs updating for names and email sign-in” | Run `supabase/schema.sql` again in Supabase’s SQL Editor. |

## 8. Privacy

- Everything is stored on your devices (IndexedDB). With Cloud sync it’s also in **your own** Supabase project; only your paired devices can read it (row-level security).
- Match photos never leave your computer — only tags, ratings and file names are stored.
- Receipt photos in Warranties & documents *are* synced (resized to stay small) so every device can see them.
- Email sign-in is optional. Only members of your household can see names and emails in it.
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
js/core/search.js · reminders.js   search scoring + reminder rules used by every tool's hooks
js/settings/           you & sign-in, locations, teams, pairing, backup
js/tools/<tool>/       library · inventory · pantry · warranties · sports · photo · golf · reminders
js/tools/<tool>/hooks.js   optional: search(q) and reminders(now) for the start menu
supabase/schema.sql    tables, row-level security, newest-wins trigger, realtime
scripts/update-sw.mjs  refreshes the offline file list + version hash (npm run sw)
scripts/run-e2e.mjs    starts a test server + test relays and runs every browser test
.github/workflows/test.yml   runs unit + browser tests on every push
tests/                 unit tests (*.test.mjs) + browser tests (e2e-*.cjs, a11y.cjs, perf.cjs)
```

**Adding a tool:** create `js/tools/mytool/index.js` exporting `{ routes: { '': render, … }, nav: […], exports: [CSV exports] }`, add one line to `js/tools.js`, run `npm run sw`. Save data with `store.put('mycollection', {...})` — it syncs and backs up automatically. To appear in start-menu search and Reminders, add `hooks: () => import('./tools/mytool/hooks.js')` to its line and export `search(q)` / `reminders(now)` from that file (see `js/core/search.js` and `js/core/reminders.js`).

**Data model:** every record lives in a named collection with `updatedAt`/`updatedBy` (and `createdBy` for records made since names were added); deletes are tombstones; merging is newest-wins (same rule enforced by the Supabase trigger). New fields are optional and older records keep working without being rewritten (e.g. old swings are grouped into sessions on the fly; lent items without a date use their last-changed date).

**Tests** (they also run on GitHub for every push — see the **Actions** tab):
```bash
npm install                      # dev tools: Playwright, test relays, PGlite, axe-core
npx playwright install chromium  # once
npm test                         # unit tests: ISBN, lookups, scoring, photo matching + RAW/ZIP, golf, search, reminders, pantry, warranties, Supabase schema
npm run test:e2e                 # every browser test (starts its own server and relays)
npm run test:e2e -- golf hub     # just some of them: library inventory sports photo golf hub core offline supabase a11y perf
npm run test:live                # real ISBN lookups (needs internet)
python3 tests/make-photo-fixtures.py   # regenerates the sample photos (JPEG, RAW, HEIC) with EXIF times
```
`a11y.cjs` audits the main screens with axe-core in light and dark mode; `perf.cjs` loads 5,000 books and 3,000 photos and fails if a screen is slow or freezes.

Credits: Open Library, Google Books, Open Food Facts, UPCitemdb, Open-Meteo, html5-qrcode (ZXing), qrcode-generator, MQTT.js, supabase-js, exifr, heic2any.
