# SENTINEL // HQ

A spy-themed home command centre. Your computer is **HQ**. Old phones and tablets become **Agents** that HQ sends on missions: watching for motion, guarding a door, listening for loud noises, acting as a doorbell or a wall display.

- **Everything stays at home.** HQ is one Node.js program with a SQLite database on your computer. There's no cloud account and no subscription.
- **£0 hardware.** You use devices you already own. Add as many Agents as you like; each takes under a minute.
- **Private by design.** Cameras and microphones are only used *on the Agent*. HQ only ever receives events like "Motion detected" or "Loud sound: 72 dB", never pictures, video or audio.

> Looking for HomeBase? It is archived on the [`homebase-archive`](../../tree/homebase-archive) branch. See [HomeBase](#homebase-the-old-app) at the end.

---

## Contents

1. [Starting HQ](#1-starting-hq)
2. [Recruiting a new Agent](#2-recruiting-a-new-agent)
3. [Assigning missions](#3-assigning-missions)
4. [Who's home (Wi-Fi recon)](#4-whos-home-wi-fi-recon)
5. [Alerts on your phone](#5-alerts-on-your-phone)
6. [Away from home (Tailscale)](#6-away-from-home-tailscale)
7. [Threat level and the Mission Log](#7-threat-level-and-the-mission-log)
8. [Privacy rules](#8-privacy-rules)
9. [Troubleshooting](#9-troubleshooting)
10. [For tinkerers](#10-for-tinkerers)

---

## 1. Starting HQ

**You need:** a computer that stays on at home (Mac, Windows, Linux or a Raspberry Pi 4/5) with **Node.js 22.13 or newer**. Get Node from <https://nodejs.org> (choose "LTS").

```bash
# once: download SENTINEL and install its two small helpers
git clone https://github.com/aaravshah11-tech/barcode-1-.git sentinel
cd sentinel
npm install

# every time: start HQ
npm start
```

You'll see:

```
  ███ SENTINEL // HQ ONLINE ███

  Command Centre (on this computer):  https://localhost:8443
  Command Centre (other devices):     https://192.168.1.10:8443
  Phone setup page (certificate):     http://192.168.1.10:8080
```

1. **On the HQ computer**, open **https://localhost:8443**. The browser may warn about the certificate the first time. That's expected (see *Why the certificate?* below); choose *Advanced → Proceed*.
2. **Choose a password.** This can only be done on the HQ computer itself, so nobody else on your Wi-Fi can claim HQ first.
3. Enjoy the boot sequence. You're in the **Command Centre**: radar, Agents, Mission Log, who's home and the threat level.

Keep the Terminal window open; **Ctrl + C** stops HQ.

### Start automatically

```bash
npm run autostart          # start HQ when the computer starts, and restart it if it ever stops
npm run autostart -- remove
```

This works on macOS and Linux (including a Raspberry Pi). On Windows it prints the one command to paste. On a Pi, also run `sudo loginctl enable-linger $USER` (the script reminds you) so HQ starts even before anyone logs in.

### Why the certificate?

Phones only allow camera, motion sensors, "keep screen on" and installable apps on **secure (HTTPS)** pages. HQ therefore makes its own little certificate authority, **"SENTINEL Local CA"**, the first time it starts. It's stored in `data/certs` and never leaves your computer. Each phone trusts it once (step 2 below), and from then on everything has a padlock.

- To stop the warning on the HQ computer too: run `npm run cert` and follow what it prints. On a Mac that's: open the `.crt` → Keychain Access → double-click *SENTINEL Local CA* → *Trust* → *Always Trust*.
- If you have [mkcert](https://github.com/FiloSottile/mkcert) installed, HQ uses it instead and trusts itself on the HQ computer automatically.
- If your computer's address changes, HQ adds the new address to its certificate the next time it starts. Phones don't need to do anything again.

### Forgot the password?

```bash
npm run reset-password
```

Then open https://localhost:8443 on the HQ computer and choose a new one. Your Agents and log are kept.

---

## 2. Recruiting a new Agent

Any old phone or tablet with a camera and a browser will do: iPhone/iPad (Safari) or Android (Chrome). Connect it to your **home Wi-Fi** first.

**On HQ:** press **＋ RECRUIT**. A QR code and a 6-character code appear, valid for 10 minutes and usable once.

**On the old phone:**

1. **Scan the QR code** with the camera app. This opens HQ's *setup page*.
2. **First time only: trust HQ's certificate.** The setup page detects your phone and shows the exact steps. They look like this:
   - **iPhone / iPad:** tap **Download HQ certificate** → *Allow*. Open **Settings** → **Profile Downloaded** → **Install** (enter passcode) → **Install** → **Done**. Then **Settings → General → About → Certificate Trust Settings** → switch on **SENTINEL Local CA** → **Continue**.
   - **Android:** tap **Download HQ certificate**. Open **Settings**, search **"CA certificate"** (usually *Security → More security settings → Encryption & credentials → Install a certificate → CA certificate*) → **Install anyway** → pick **SENTINEL-HQ.crt** from Downloads.
   - Go back to the browser and tap **Done — continue**.
3. The page checks it can reach HQ securely and **pairs automatically**. A second or two later the Agent says **"SENTINEL AGENT ACTIVE – STANDBY"**, and a new blip appears on HQ's radar with a codename like **AGENT-03 "FALCON"**.
4. **Install it as an app** (recommended): *iPhone:* Share → **Add to Home Screen**. *Android:* ⋮ → **Install app** / **Add to Home screen**. Open it from the Home Screen from now on.
5. Put the phone **on charge** and leave the SENTINEL screen open. It keeps the screen awake and dims itself after a minute; tap to brighten.

QR code won't scan (or no camera)? On the device open the `http://…:8080` address shown in the Recruit window and type the 6-character code.

**Security:** an Agent gets its own secret key when it pairs. Every order from HQ is signed with that key, and the Agent ignores anything unsigned, old or replayed, so it only takes orders from *its* HQ. "Disconnect" on HQ cancels the key immediately.

---

## 3. Assigning missions

On HQ, **click an Agent** (in the list or its blip on the radar). The drawer lets you:

- **Rename** it (codename and a place, e.g. "Hallway").
- **Change mission** and its settings. The Agent switches within a second.
- **Find**: makes it flash, beep and vibrate so you can spot it.
- **Wake / Reload** its screen, or **Disconnect** it for good.

| Mission | What it does | Tips |
|---|---|---|
| **STANDBY** | Connected, waiting for orders. | |
| **MOTION WATCH** | Spots movement with the camera. Settings: sensitivity (1–10), cooldown, back/front camera, **ignore zones**. | Prop the phone up facing the room. To ignore a TV, window or pet bed, tap **Ignore zones** *on the Agent*, tap the squares, then **Save zones**. Sudden lighting changes are ignored on purpose. |
| **DOOR TRIPWIRE** | Feels a door swing using the gyroscope. No camera. Settings: opening angle, cooldown, report closing. | Stick the phone flat on the door (Blu Tack or tape), away from the hinge. iPhone: tap **Allow motion sensors** once. Test it by opening the door a little. |
| **SOUND LEVEL** | Measures loudness in dB. Settings: alert above (dB), how long, cooldown, calibration. | Phone mics differ. Watch the live reading on HQ in a quiet room (~30–40 dB) and adjust *calibration* if it's far off. |
| **LIGHT CHECK** | Notices lights switched on/off from overall brightness. | Point it at the room, not at a lamp. |
| **DOOR PANEL** | One big button: a DIY doorbell. Pressing it alerts HQ. | Change the button text, e.g. "RING FOR PIZZA". |
| **INTEL SCREEN** | Read-only wall display of the radar, threat level and Mission Log. Never dims. | Great for an old tablet on a shelf. |

Every Agent always shows a banner: **"SENTINEL AGENT ACTIVE – [mission]"**. There is no hidden mode. A red banner means the camera or microphone is in use *on that device*.

Want to build your own mission? See [`public/agent/missions/README.md`](public/agent/missions/README.md).

---

## 4. Who's home (Wi-Fi recon)

Every minute HQ quietly checks which devices are on your Wi-Fi (it reads the computer's ARP table, the list of "this network address belongs to this device"). Phones linked to a person mark that person **HOME**.

**Set it up:** Command Centre → **Who's home → Manage** (or ⚙ → **People**):

1. **Add a person**, e.g. "Mum".
2. Find their phone in **Devices on your Wi-Fi**. Not sure which one? Turn that phone's Wi-Fi off and on, press **Scan now**, and see which line jumps to the top.
3. Give the device a name and choose its **owner**. The person shows **HOME**, and the Mission Log says "Mum arrived home".
4. Untick **Track** to stop tracking someone (e.g. a visitor), and tick **Ignore** for things like the router or the TV.

**Grace period:** phones switch Wi-Fi off to save battery when the screen is off, so a person is only marked **AWAY** after not being seen for **15 minutes** (you can change this under *Timing*).

### Private / random Wi-Fi addresses

To stop shops tracking people, modern phones invent a **random Wi-Fi address (MAC address)** for each network. SENTINEL marks these **PRIVATE ADDRESS**. That's fine as long as the address **stays the same on your home Wi-Fi**:

- **iPhone / iPad:** Settings → Wi-Fi → ⓘ next to your home network → **Private Wi-Fi Address** → set to **Fixed** (iOS 18+) or **Off** (older iOS). Avoid "Rotating".
- **Android:** Settings → Wi-Fi → your network (⚙) → **Privacy** → **Use device MAC**, or leave *randomised MAC* on (it normally stays the same per network). Avoid "re-randomise each time".

If someone suddenly shows **AWAY** while they're home, look for a new device in the list and give it to them.

**HOME / AWAY switch:** the **AUTO · HOME · AWAY** buttons at the top of the Command Centre override Wi-Fi recon, e.g. set **AWAY** when you go on holiday.

> On a Mac, devices can stay in the ARP list for up to ~20 minutes after leaving, so "left home" may be slower than on Linux/Raspberry Pi.

---

## 5. Alerts on your phone

SENTINEL can send notifications to **your own phone** (not the Agents).

1. On your phone, open the Command Centre (`https://<HQ address>:8443`). This phone also needs the certificate from step 2 of *Recruiting*.
   - **iPhone:** first **Share → Add to Home Screen**, then open SENTINEL **from the Home Screen** and log in. Apple only allows notifications for Home Screen web apps (iOS 16.4+).
2. ⚙ → **Alerts** → name the device → **🔔 Turn on alerts here** → **Allow**. A welcome alert arrives.
3. Choose what you want:
   - **Motion, door or noise while nobody's home** (on): the important one. It's sent as **THREAT RED** with high priority.
   - **Someone arrives home** (on) / **leaves home** (off).
   - **A door is opened** even when someone's home (off).
   - **Someone presses a DOOR PANEL** (on).
   - **Loud sound** when someone's home (off).
   - **An Agent goes offline** (on), e.g. battery died or the phone left the Wi-Fi. HQ waits 20 seconds first so Wi-Fi blips don't count.
4. **Quiet hours** (e.g. 22:00–07:00): only "nobody's home" alerts get through. Everything is still logged.

Use **Test** to check it works. Each type of alert is sent at most once every 30 seconds.

**How it travels:** HQ encrypts the short text and hands it to your phone's push service (Apple or Google), which delivers it even when you're out. They can't read it. HQ needs an internet connection for this; nothing else needs one.

---

## 6. Away from home (Tailscale)

Alerts reach you anywhere. To **open the Command Centre** when you're out, use **Tailscale**: a free, private, encrypted link between *your own* devices. Nothing is opened to the internet, and you don't need to change any router settings.

1. Install **Tailscale** on the HQ computer (<https://tailscale.com/download>) and sign in.
2. Install the **Tailscale** app on your phone and sign in with the **same account**. Turn it on.
3. On the HQ computer, run **once**:
   ```bash
   tailscale serve --bg https+insecure://localhost:8443
   ```
   It prints an address like `https://my-mac.tail1234.ts.net`.
4. Open that address on your phone (with Tailscale on). It has a normal padlock, so no certificate steps are needed. Add it to your Home Screen.

(Alternative: open `https://<HQ's 100.x.y.z Tailscale address>:8443`. This works on phones that already trust the SENTINEL certificate. ⚙ → General shows the address when Tailscale is running.)

To stop it: `tailscale serve --https=443 off`.

---

## 7. Threat level and the Mission Log

- **GREEN**: all quiet.
- **AMBER**: activity in the last 5 minutes (motion, door, sound, light or a knock) while someone's home, or when HQ doesn't know.
- **RED**: activity while **nobody's home**. The reason is shown, e.g. "Motion detected while nobody's home", and stays for 15 minutes.

The **Mission Log** records everything: Agents joining and leaving, missions, motion, doors, arrivals, threat changes. Use the filters to narrow it down.

- Entries older than **30 days are deleted automatically**. Change this in ⚙ → General.
- **Export** as **CSV** (opens in Excel/Numbers/Sheets) or **JSON** from ⚙ → General.
- **Scanlines, glitch and typewriter effects** can be switched off in ⚙ → General (this also applies to the Agents). They're also skipped automatically if your device asks for reduced motion.

---

## 8. Privacy rules

These rules are built in and tested:

1. **Camera and microphone data is processed on the Agent only.** No images, video or audio are recorded, saved, streamed or sent, only events such as "motion detected" or "sound level 72 dB". HQ also throws away any long piece of data an Agent sends, so a picture couldn't get through even by mistake. The automated tests check every message.
2. **Every active Agent shows a visible "SENTINEL AGENT ACTIVE – [mission]" banner.** There is no hidden mode.
3. **All data stays on HQ** (`data/sentinel.db`). Log entries auto-delete after 30 days (configurable) and can be exported as CSV/JSON. The only things that leave your house are push alerts (encrypted, text only) and, if you set it up, your own Tailscale link.

Please only point cameras at your own home, and tell the people who live with you that SENTINEL is running.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| **"Port 8443 is already in use"** | HQ is already running (maybe started automatically). Close the other one, or use another port: `SENTINEL_HTTPS_PORT=9443 SENTINEL_HTTP_PORT=9080 npm start`. |
| **Phone can't open the setup page** | Phone and HQ must be on the same Wi-Fi (not "guest" Wi-Fi). Check the address printed by `npm start`. If the guess is wrong (e.g. you have a VPN), set it: `SENTINEL_PUBLIC_IP=192.168.1.10 npm start`. Allow Node through the computer's firewall if asked. |
| **Setup page keeps saying the certificate isn't trusted** | iPhone: you need **both** steps: install the profile **and** switch it on in *Certificate Trust Settings*. Android: install it as a **CA certificate** (not "VPN & app" or "Wi-Fi"). Then tap *continue* again. |
| **"That code is wrong, used or expired"** | Codes last 10 minutes and work once. Press **RECRUIT** for a new one. |
| **Agent shows "RECONNECTING TO HQ"** | Is HQ running? Is the phone on the home Wi-Fi? It retries by itself. If HQ's address changed, open the setup page again. |
| **Agent shows "This device is not paired"** | It was disconnected on HQ (or HQ's data was deleted). Recruit it again. |
| **Camera / microphone / motion "blocked"** | Allow it for this site: *iPhone:* Settings → Safari → Camera/Microphone (or the **aA** menu → Website Settings). *Android:* tap the padlock → Permissions. Then press **Reload** in HQ's drawer for that Agent. |
| **Door tripwire never fires** | Stick the phone flat on the door, well away from the hinge. Lower the *opening angle*. iPhone: tap **Allow motion sensors** on the Agent. |
| **Too many / too few motion alerts** | Lower or raise *sensitivity*, raise the *cooldown*, add **ignore zones** over TVs, windows and plants. |
| **Agent screen went to sleep / camera stopped** | Keep SENTINEL open and in front, on charge. iPhone: Settings → Display → Auto-Lock → Never helps. Open it from the Home Screen icon. Don't use Low Power Mode. |
| **Someone shows AWAY while home** | Their phone probably has a new private address. ⚙ → People → find the new device → give it to them. See *Private / random Wi-Fi addresses*. |
| **No devices in "Devices on your Wi-Fi"** | HQ must be on the same network as the phones (Wi-Fi or Ethernet to the same router). The status line under *Scan now* explains any error. |
| **Alerts don't arrive** | Press **Test** in ⚙ → Alerts. The line shows "delivered" or the error. HQ needs internet. *iPhone:* it must be opened from the Home Screen icon, with notifications allowed under Settings → Notifications → SENTINEL. Check Focus / Do Not Disturb. |
| **Forgot the password** | `npm run reset-password`, then open https://localhost:8443 on the HQ computer. |
| **Start completely fresh** | Stop HQ and delete the `data` folder. (Phones then need recruiting again, and they'll need the new certificate.) |

---

## 10. For tinkerers

```
server/            HQ (Node.js)
  index.js         starts everything (npm start)
  hq.js            the brain: Agents, Mission Log, threat level, pairing, signed orders
  http.js          web server + API      hub.js     live WebSocket link
  db.js            SQLite (node:sqlite)  certs.js   HTTPS certificates
  recon.js         Wi-Fi recon           alerts.js  web push alerts
public/
  dashboard/       the Command Centre    agent/     the Agent app + missions/
  setup/           the "trust this HQ" page (plain HTTP, port 8080)
  shared/          theme, radar, logo, mission list, helpers
scripts/           cert, autostart, reset-password, make-icons
tests/unit/        node --test           tests/e2e/   real browser tests (Playwright)
data/              your database and certificates (created on first start, never committed)
```

- **Tests:** `npm test` (unit) and `npm run test:e2e` (starts throwaway HQs and drives real Chromium Agents with a fake camera, microphone, motion sensors, Wi-Fi table and push service). Needs `npx playwright install chromium` once.
- **Settings by environment variable:** `SENTINEL_DATA` (data folder), `SENTINEL_HTTPS_PORT`, `SENTINEL_HTTP_PORT`, `SENTINEL_HOST`, `SENTINEL_PUBLIC_IP`, `SENTINEL_NO_MKCERT=1`, `SENTINEL_NO_RECON=1` (turn off Wi-Fi recon).
- **Raspberry Pi:** use Raspberry Pi OS 64-bit, install Node 22 from nodejs.org (or `nvm`), then the same steps. Give the Pi a fixed address in your router so phones always find it.

---

## HomeBase (the old app)

HomeBase was retired when SENTINEL arrived. Nothing was deleted:

- The full HomeBase code is on the **`homebase-archive`** branch. To bring it back: `git checkout homebase-archive`.
- The old GitHub Pages site now shows a "HomeBase has been retired" page, and its service worker removes itself from phones that had it installed (`index.html` and `sw.js` in this folder). Once you're happy, you can switch GitHub Pages off completely: repo **Settings → Pages → Source: None**.
