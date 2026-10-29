// NETWORK ASSET REGISTER + HEALTH CHECK (pure logic).
// SENTINEL never scans anything. Devices come only from: SENTINEL itself (HQ, Agents, linked phones),
// devices you add by hand, and a device list you copy from YOUR OWN router's admin page.

/** First half of a MAC address → maker (a short list of common home-device makers). */
const OUI = {
  '00:17:88': 'Philips Hue', 'EC:B5:FA': 'Philips Hue', '00:1A:11': 'Google', 'F4:F5:D8': 'Google', '3C:5A:B4': 'Google', '54:60:09': 'Google', 'D8:EB:46': 'Google', '1C:F2:9A': 'Google',
  'F0:D2:F1': 'Amazon', '44:65:0D': 'Amazon', '74:C2:46': 'Amazon', 'FC:65:DE': 'Amazon', '68:54:FD': 'Amazon', '0C:47:C9': 'Amazon', '40:B4:CD': 'Amazon',
  '00:03:93': 'Apple', '3C:22:FB': 'Apple', 'A4:83:E7': 'Apple', 'F0:18:98': 'Apple', 'AC:BC:32': 'Apple', '28:CF:E9': 'Apple', 'BC:D0:74': 'Apple', '8C:85:90': 'Apple', 'DC:A9:04': 'Apple', '70:3E:AC': 'Apple',
  '00:12:FB': 'Samsung', '5C:0A:5B': 'Samsung', '8C:77:12': 'Samsung', 'F8:04:2E': 'Samsung', 'CC:07:AB': 'Samsung', '84:25:19': 'Samsung',
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi', '28:CD:C1': 'Raspberry Pi',
  '24:0A:C4': 'Espressif (smart plug / IoT)', '30:AE:A4': 'Espressif (smart plug / IoT)', 'A4:CF:12': 'Espressif (smart plug / IoT)', 'BC:DD:C2': 'Espressif (smart plug / IoT)', '84:F3:EB': 'Espressif (smart plug / IoT)', 'C8:2B:96': 'Espressif (smart plug / IoT)',
  '50:C7:BF': 'TP-Link', 'F4:F2:6D': 'TP-Link', 'B0:BE:76': 'TP-Link', '98:DA:C4': 'TP-Link', '14:EB:B6': 'TP-Link',
  '00:0E:58': 'Sonos', '5C:AA:FD': 'Sonos', '48:A6:B8': 'Sonos', '94:9F:3E': 'Sonos',
  '00:09:5B': 'Netgear', 'A0:40:A0': 'Netgear', '9C:3D:CF': 'Netgear', '24:A4:3C': 'Ubiquiti', 'FC:EC:DA': 'Ubiquiti', '78:8A:20': 'Ubiquiti',
  '00:50:F2': 'Microsoft', '7C:1E:52': 'Microsoft', '98:5F:D3': 'Microsoft', '00:1F:32': 'Nintendo', '98:B6:E9': 'Nintendo', '00:04:1F': 'Sony', 'FC:0F:E6': 'Sony', 'BC:60:A7': 'Sony',
  'A8:23:FE': 'LG', '64:BC:0C': 'LG', '34:3E:A4': 'Ring', '9C:76:13': 'Ring', '64:16:66': 'Nest', '18:B4:30': 'Nest',
  '28:6C:07': 'Xiaomi', '64:09:80': 'Xiaomi', '00:E0:4C': 'Realtek', '3C:7C:3F': 'ASUS', '04:D4:C4': 'ASUS', '00:1B:21': 'Intel', '3C:A9:F4': 'Intel', '8C:8D:28': 'Intel',
};
export const normMac = (m) => { const h = String(m || '').replace(/[^0-9a-f]/gi, '').toUpperCase(); return h.length === 12 ? h.match(/../g).join(':') : ''; };
/** A "private" (randomised) address — phones use these on each Wi-Fi network. */
export const isRandomMac = (mac) => { const m = normMac(mac); return !!m && (parseInt(m.slice(0, 2), 16) & 2) === 2; };
export function vendorOf(mac) {
  const m = normMac(mac);
  if (!m) return '';
  if (isRandomMac(m)) return 'Private address (phone or laptop)';
  return OUI[m.slice(0, 8)] || '';
}

export const ASSET_TYPES = [['phone', 'Phone'], ['tablet', 'Tablet'], ['laptop', 'Laptop / computer'], ['tv', 'TV / streaming'], ['speaker', 'Speaker / assistant'], ['camera', 'Camera / doorbell'], ['iot', 'Smart home / IoT'], ['console', 'Games console'], ['router', 'Router / network'], ['other', 'Other']];
const TYPE_KEYS = new Set(ASSET_TYPES.map(([k]) => k));
const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
export function guessType(name = '', vendor = '') {
  const t = `${name} ${vendor}`.toLowerCase();
  if (/iphone|android|pixel|galaxy|phone/.test(t)) return 'phone';
  if (/ipad|tablet|kindle|fire/.test(t)) return 'tablet';
  if (/macbook|laptop|desktop|pc|windows|imac|surface|thinkpad/.test(t)) return 'laptop';
  if (/tv|roku|chromecast|firestick|appletv|apple-tv|shield|bravia/.test(t)) return 'tv';
  if (/echo|alexa|sonos|homepod|nest-?(mini|audio)|speaker/.test(t)) return 'speaker';
  if (/ring|doorbell|cam|arlo|blink/.test(t)) return 'camera';
  if (/esp|espressif|plug|bulb|hue|tuya|shelly|tasmota|smart|thermostat|nest/.test(t)) return 'iot';
  if (/xbox|playstation|ps[45]|nintendo|switch/.test(t)) return 'console';
  if (/router|tp-link|netgear|ubiquiti|mesh|extender|deco|orbi/.test(t)) return 'router';
  return 'other';
}

/** Clean a hand-edited asset. */
export function cleanAsset(a = {}, now = Date.now()) {
  const mac = normMac(a.mac);
  return {
    id: str(a.id, 64) || `as-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: str(a.name, 60) || 'Unnamed device', owner: str(a.owner, 30), vendor: str(a.vendor, 50) || vendorOf(mac),
    type: TYPE_KEYS.has(a.type) ? a.type : guessType(a.name, a.vendor || vendorOf(mac)),
    mac, ip: /^\d{1,3}(\.\d{1,3}){3}$/.test(String(a.ip || '').trim()) ? String(a.ip).trim() : '',
    trusted: !!a.trusted, source: ['sentinel', 'manual', 'import'].includes(a.source) ? a.source : 'manual',
    firstSeen: Number(a.firstSeen) || now, lastSeen: Number(a.lastSeen) || now, notes: str(a.notes, 300),
    ...(a.ref ? { ref: str(a.ref, 80) } : {}),
  };
}

/**
 * Read a device list copied from a router's admin page (or a CSV export). Each line with a MAC address
 * becomes a device; an IP address and the rest of the line (the name) are picked up if present.
 */
export function parseRouterList(text) {
  const out = [], seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const macM = line.match(/\b([0-9a-f]{2}([:-])(?:[0-9a-f]{2}\2){4}[0-9a-f]{2})\b/i) || line.match(/\b([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\b/i);
    if (!macM) continue;
    const mac = normMac(macM[1]);
    if (!mac || seen.has(mac)) continue;
    seen.add(mac);
    const ip = (line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/) || [])[1] || '';
    let name = line.replace(macM[1], ' ').replace(ip, ' ').split(/[,\t;|]+/).map((x) => x.trim()).filter((x) => x && !/^(wired|wireless|wifi|wi-fi|2\.4ghz|5ghz|lan|online|connected|active|dhcp|static|\d+ ?(mbps|dbm))$/i.test(x) && !/^-?\d+$/.test(x))[0] || '';
    name = name.replace(/\s{2,}/g, ' ').slice(0, 60);
    out.push({ mac, ip, name });
  }
  return out;
}

/** Merge an import into the register: known devices are refreshed, new ones are added (untrusted). */
export function mergeImport(assets, rows, now = Date.now()) {
  const list = assets.map((a) => ({ ...a }));
  const added = [], seen = [];
  for (const r of rows) {
    const a = list.find((x) => x.mac && x.mac === r.mac);
    if (a) { a.lastSeen = now; if (r.ip) a.ip = r.ip; if (!a.name || a.name === 'Unnamed device') a.name = r.name || a.name; seen.push(a); continue; }
    const n = cleanAsset({ name: r.name || vendorOf(r.mac) || 'Unknown device', mac: r.mac, ip: r.ip, source: 'import', trusted: false, firstSeen: now, lastSeen: now }, now);
    list.push(n); added.push(n);
  }
  return { assets: list, added, seen };
}

/** Questions about your own router that a web page can't check for you. */
export const ROUTER_CHECKS = [
  { id: 'wpa', ok: 'Wi-Fi uses WPA2/WPA3 security', q: 'Is your Wi-Fi using WPA3 or WPA2 security (not WEP, not open)?', fix: 'In your router’s Wi-Fi settings choose WPA3 (or WPA2/WPA3 mixed). Never use WEP or an open network.', weight: 3 },
  { id: 'adminpw', ok: 'Router admin password has been changed', q: 'Have you changed the router’s admin password from the one printed on it?', fix: 'Log in to the router and set a long, unique admin password. The printed one is often guessable.', weight: 3 },
  { id: 'firmware', ok: 'Router firmware is up to date', q: 'Has the router’s firmware been updated in the last 6 months (or does it update itself)?', fix: 'Look for “Firmware update” or “Auto update” in the router settings and turn automatic updates on.', weight: 2 },
  { id: 'wps', ok: 'WPS is off', q: 'Is WPS (the push-button pairing) turned off?', fix: 'Turn WPS off. Its PIN mode can be cracked.', weight: 2 },
  { id: 'remote', ok: 'Remote administration is off', q: 'Is remote administration (managing the router from the internet) turned off?', fix: 'Turn off “Remote management” unless you really need it.', weight: 2 },
  { id: 'upnp', ok: 'UPnP is off or under control', q: 'Is UPnP turned off (or do you know which devices use it)?', fix: 'Turn off UPnP if nothing needs it — it lets devices open holes in your firewall by themselves.', weight: 1 },
  { id: 'guest', ok: 'Smart-home gadgets are on a separate network', q: 'Are smart-home gadgets on a separate guest / IoT network?', fix: 'Put plugs, bulbs, cameras and TVs on the guest network so a weak gadget can’t reach your laptops.', weight: 1 },
];

/**
 * Health check: plain-English findings, worst first. facts = { https, persisted, autoLockMin, twoFactor,
 * pinStrength, viewers: [{ label, lastSeen }], assets, answers: { [id]: 'yes'|'no'|'unknown' }, now }
 */
export function healthCheck(f) {
  const now = f.now ?? Date.now(), out = [];
  const add = (level, title, advice) => out.push({ level, title, advice });
  if (!f.https) add('high', 'HQ is not using a secure (https) address', 'Open HQ from its https:// address so the link to Agents and phones is encrypted end to end.');
  else add('ok', 'Secure connection (https) in use', '');
  if (f.pinStrength === 'weak') add('high', 'The Director PIN is short', 'Use at least 6 digits, or a password. Settings › Security › Change PIN.');
  else if (f.pinStrength) add('ok', 'Director sign-in is reasonably strong', '');
  if (f.twoFactor === false) add('medium', 'Two-step sign-in (2FA) is off', 'Turn on two-step sign-in with an authenticator app (Settings › Security).');
  else if (f.twoFactor) add('ok', 'Two-step sign-in is on', '');
  if (!f.autoLockMin) add('medium', 'HQ never locks itself', 'Set Auto-lock to 15 minutes so an unattended HQ can’t be used by someone else.');
  if (f.persisted === false) add('low', 'The browser may clear HQ’s data when space runs low', 'Keep HQ in a normal (not private) window and allow “persistent storage” if asked.');
  const stale = (f.viewers || []).filter((v) => now - (v.lastSeen || 0) > 30 * 86400000);
  if (stale.length) add('medium', `${stale.length} linked phone${stale.length === 1 ? ' hasn’t' : 's haven’t'} been used for 30 days`, `Unlink phones you no longer use (Settings › Phones): ${stale.map((v) => v.label).join(', ')}.`);
  const untrusted = (f.assets || []).filter((a) => !a.trusted);
  if (untrusted.length) add('medium', `${untrusted.length} device${untrusted.length === 1 ? ' is' : 's are'} not marked as trusted`, 'Check each one in the asset register. If you don’t recognise it, change your Wi-Fi password.');
  const iot = (f.assets || []).filter((a) => a.type === 'iot' || a.type === 'camera');
  if (iot.length && f.answers?.guest !== 'yes') add('low', `${iot.length} smart-home gadget${iot.length === 1 ? '' : 's'} on your network`, 'Gadgets rarely get security updates. Keep them on a guest/IoT network and update their apps.');
  for (const c of ROUTER_CHECKS) {
    const a = f.answers?.[c.id];
    if (a === 'no') add(c.weight >= 3 ? 'high' : c.weight === 2 ? 'medium' : 'low', `Not done: ${c.ok.charAt(0).toLowerCase()}${c.ok.slice(1)}`, c.fix);
    else if (!a || a === 'unknown') add('info', `Unchecked: ${c.q}`, c.fix);
    else add('ok', c.ok, '');
  }
  const order = { high: 0, medium: 1, low: 2, info: 3, ok: 4 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  const penalty = out.reduce((s, x) => s + ({ high: 25, medium: 10, low: 4, info: 2, ok: 0 }[x.level]), 0);
  return { score: Math.max(0, 100 - penalty), findings: out };
}
