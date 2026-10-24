# 📚 Shelf: your home library

Shelf catalogues the books in your house. **Scan a book's barcode with your phone and it shows up on your computer straight away.** Your phone becomes a barcode reader for your computer.

- Works on phones, tablets and computers in the browser. Install it to your home screen like an app.
- Works offline. Your library is stored on each device; nothing goes to a paid service.
- Free to host on GitHub Pages or Netlify.

---

## What it does

| | |
|---|---|
| **Scan** | Point your phone's camera at the barcode on the back of a book (EAN-13 / ISBN-13, or type an ISBN-10/13). |
| **Auto-fill** | Looks the book up on **Open Library**, with **Google Books** filling any gaps: title, subtitle, authors, cover, publisher, year, pages, genres, description and language. |
| **Location** | Room → Bookcase/Area → Shelf, e.g. *Living room › Tall bookcase › Shelf 3*. It remembers the last place you used. |
| **Where is it?** | Scan a book, or search by title or author, and Shelf shows where it should be (and warns you if it's lent out). |
| **Duplicate check** | Scan a book you already have and Shelf shows where it lives instead of adding it again. |
| **Your copy** | Owner (family member), read / reading / unread, 1–5 stars, notes, date added, lent to (name + date), favourite. |
| **Library** | Cover grid or list. Search, filter (room, author, genre, status, owner, lent out, favourites) and sort (title, author, date added, rating, location). |
| **Batch mode** | Set the location once, then scan book after book. Each one saves instantly with a beep (and a buzz on Android). |
| **Stats** | Total books and pages, books per room and bookcase, top authors and genres, read vs unread. |
| **Backup** | Export JSON (full backup) and CSV (spreadsheet). Import a JSON backup. |
| **Phone ↔ computer** | Link a phone to a computer with a QR code. Changes on either device appear on the other live. |

If a book isn't found online, Shelf opens a form so you can type it in and take a photo of the cover. If you're offline, you can still save the book; Shelf fills in the details when you're back online.

---

## 1. Put it online for free (GitHub Pages)

Phones only allow the camera on **https://** websites, so the app needs to be online. GitHub Pages is free and gives you https automatically.

1. **Get the code onto your default branch.** The code is on the branch `claude/elegant-keller-rv8z5c`. On GitHub, open the repository, click **Pull requests → New pull request**, choose that branch, then **Create pull request → Merge**. Or skip this and pick that branch in step 3.
2. On GitHub, open your repository and click **Settings** (top right of the repo).
3. In the left menu click **Pages**. Under **Build and deployment**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` (or the branch above), folder **`/ (root)`**, then **Save**.
4. Wait 1–2 minutes, then refresh the page. A box appears saying **"Your site is live at …"**. For this repo it will be:
   **`https://aaravshah11-tech.github.io/barcode-1-/`**
5. Open that link on your phone and your computer. Done!

> **Private repo?** GitHub Pages on a private repository needs a paid GitHub plan. Either make the repo public (your *library data* is never stored in the repo, only the app code), or use Netlify below.

### Alternative: Netlify (drag and drop)

1. Download the code: on GitHub click **Code → Download ZIP**, then unzip it.
2. Go to **https://app.netlify.com/drop** and sign up for free.
3. Drag the unzipped folder (the one containing `index.html`) onto the page.
4. Netlify gives you an https link like `https://something.netlify.app`. Rename it under **Site configuration → Change site name**.

### Updating later

Push or merge changes to the branch and GitHub Pages redeploys in about a minute. Open the app twice to get the new version, or tap **Update** when Shelf says a new version is ready. When you change app files, also bump `VERSION` at the top of `sw.js` so phones notice the update quickly.

---

## 2. Install it on your phone

**iPhone / iPad (Safari):**
1. Open your Shelf link in **Safari**.
2. Tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open Shelf from the home screen icon. The first time you scan, tap **Allow** for the camera.

**Android (Chrome):**
1. Open your Shelf link in **Chrome**.
2. Tap **⋮** (top right), then **Install app** (or **Add to Home screen**).
3. Open it from your home screen and allow the camera when asked.

**Computer (Chrome / Edge):** click the install icon at the right of the address bar to get Shelf in its own window. This is optional.

---

## 3. Use your phone as the scanner for your computer

1. On the **computer**, open Shelf and go to **Settings → Link phone & computer → "This is my computer"**. A QR code and a 10-character code appear.
2. On the **phone**, scan that QR code with the normal camera app and open the link. Or, in Shelf: **Settings → Link phone & computer → "This is my phone"**, then scan the code or type it.
3. Both screens now say **Linked**. Scan books on the phone (normal or **Batch** mode) and they pop up on the computer with a notification.

Good to know:
- **Each device keeps a full copy** of the library. Edits on the computer (moving a book, marking it read) go to the phone too.
- They sync **while both are open**. If the computer is off, the phone keeps everything and catches up automatically next time both are open. Keep Shelf open on the computer while you scan.
- Messages go through three free public relays at once (EMQX, HiveMQ and Mosquitto), so linking keeps working if one is down. Everything is **encrypted on your device with a key made from your pairing code**, so the relays only see scrambled data. Nothing is stored on them.
- It works whether the phone and computer are on the same Wi-Fi or not (even on mobile data).
- It reconnects by itself after a reload, a sleep or a Wi-Fi drop. To stop linking: **Settings → Link phone & computer → Unlink**.
- Anyone with your pairing code could join, so don't share it. Press **New code** to change it (then pair again).

---

## 3b. No linking needed: use your iPhone as your Mac's camera

Macs can use an iPhone as a webcam (Apple's **Continuity Camera**, macOS 13+ and iOS 16+). Shelf runs on the Mac and reads barcodes through the iPhone's camera, so books go straight into the Mac's library with nothing to link.

1. Make sure the iPhone and Mac are signed in to the **same Apple ID**, with **Wi-Fi and Bluetooth on** on both. Plugging the iPhone into the Mac with a cable makes it more reliable.
2. On the iPhone: **Settings › General › AirPlay & Continuity** (older iOS: **AirPlay & Handoff**) › turn on **Continuity Camera**.
3. Rest the iPhone **on its side (landscape), screen locked, back camera facing you**, on a stand or propped against something.
4. On the Mac, open Shelf in **Safari or Chrome** and click **Scan**. Allow the camera.
5. Shelf picks the iPhone automatically. If it shows the Mac's own camera instead, click the **⟳ switch-camera button** at the top right of the camera view and choose the iPhone.
6. Hold each book's barcode in front of the iPhone, about 20 cm away.

---

## 4. Run it on your own computer (optional, for tinkering)

You need a small local web server, because opening `index.html` directly from disk won't work. Pick one:

```bash
# Python (already on Mac/Linux)
python3 -m http.server 8080

# or Node.js
npx serve -l 8080 .
```

Then open **http://localhost:8080** in your browser. The camera works on `localhost` on your computer. To scan with a phone, use the online (https) version from step 1.

---

## Tips

- **Fast shelf-by-shelf cataloguing:** Scan → **Batch** → choose the room, bookcase and shelf → scan every book on that shelf → tap **Change** → next shelf.
- **Dark shelves?** Tap the torch button on the camera view (Android Chrome).
- **Rooms, bookcases and family members** can be added on the fly with the **+** chips, or managed in **Settings**. Deleting a room never deletes books; they just become "No location".
- **Back up** now and then: **Settings → Backup (JSON)**. Clearing your browser's website data deletes the library on that device.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Camera needs a secure (https) link" | Use the `https://…github.io/…` link, not a `http://` or local file. |
| "Camera permission is off" | iPhone: **Settings → Safari → Camera → Allow**, or in Safari tap **aA → Website Settings → Camera**. Android: tap the 🔒 next to the address → **Permissions → Camera**. |
| Barcode won't scan | Hold the book 15–25 cm away, fill the box with the barcode, and avoid glare. Or type the 13 digits under the camera. |
| "Not found online" | Some books (old, local or self-published) aren't in either database. Fill in the form; a cover photo makes it look nice. |
| Phone says "Waiting for your computer" | Open Shelf on the computer. It connects by itself within a few seconds. Both need internet. |
| "Lost connection to the relays" | Check the internet connection. Shelf keeps retrying. Your scans are saved on the phone meanwhile. |
| Book info is missing on books added offline | Go online and it fills in automatically, or tap **Settings → Fetch details**. |

---

## How it's built

Plain HTML, CSS and JavaScript with ES modules. No build step and no frameworks.

```
index.html              App shell (header, bottom tabs / desktop sidebar)
manifest.webmanifest    PWA manifest (name, icons, home-screen shortcuts)
sw.js                   Service worker: offline app + cover image cache
css/app.css             All styles, light + dark theme
js/
  app.js                Boot, hash router, header status, service worker registration
  store.js              ★ Data layer: the only code that touches the database
  db.js                 IndexedDB wrapper (used only by store.js)
  isbn.js               ISBN-10/13 validation and conversion
  lookup.js             Open Library + Google Books lookup and merging
  pending.js            Fills in books saved offline once you're online
  scanner.js            Camera scanning (html5-qrcode / ZXing / native BarcodeDetector)
  feedback.js           Beep + vibration
  backup.js             JSON / CSV export, JSON import
  ui.js                 Toasts, sheets, dialogs, covers, icons
  sync/relay-link.js    Phone ↔ computer link (encrypted, via public MQTT relays)
  components/           Location picker, book form, owner/status/rating pickers
  views/                library, scan, book, stats, settings, link
vendor/                 html5-qrcode 2.3.8, MQTT.js 5.10.4, qrcode-generator 1.4.4 (bundled for offline use)
icons/                  App icons
tests/                  Unit tests + browser end-to-end tests
```

### Data model

Each book is one record in IndexedDB (`books` store). Rooms, with their bookcases inside, are in `rooms`, and settings are in `meta`. Every synced record carries `updatedAt` and `updatedBy`. Deletes leave a small "tombstone" so they sync too. Merging is "last write wins".

### Adding cloud sync later (e.g. Supabase)

The data layer was built for this. A sync module only needs these `store.js` functions, which the phone↔computer link (`relay-link.js`) already uses:

- `store.onChange(fn)`: get every local change and push it up.
- `store.mergeRecords(data)`: apply records downloaded from the cloud (newer wins).
- `store.manifest()` / `store.recordsNewerThan(m)`: work out what the other side is missing.

A Supabase version would have tables `books`, `rooms` and `meta` (columns: `id`, `data jsonb`, `updated_at`, `library_id`). It would upsert on `onChange`, use Supabase Realtime to receive changes and pass them to `mergeRecords`, and add a sign-in so the family shares one `library_id`. You would create it as `js/sync/supabase.js` next to `relay-link.js`; nothing else needs to change.

### Tests

```bash
npm test                       # ISBN maths + lookup parsing with recorded API responses
npm run test:live              # real lookups for 9780747532699 and 9780141439518 (needs internet)

# Browser tests (Playwright + Chromium): serve the app on :8080 first
node tests/e2e.cjs             # add / duplicate / not-found / batch / where / library / stats / backup
node tests/link-e2e.cjs x.y4m  # two-device link test (needs local MQTT relays, see file header)
```

Credits: book data from [Open Library](https://openlibrary.org) and [Google Books](https://books.google.com). Barcode reading by [html5-qrcode](https://github.com/mebjas/html5-qrcode) (ZXing). Device linking by [MQTT.js](https://github.com/mqttjs/MQTT.js) over the free public brokers from EMQX, HiveMQ and Eclipse Mosquitto.
