// Wi-Fi recon helpers (pure, unit tested): read the computer's ARP table ("which network address
// belongs to which device") on macOS / Linux / Windows, and decide who's home.

const MAC_RE = /([0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}/i;

/** "a:b:c:d:e:f" / "AA-BB-..." → "0a:0b:0c:0d:0e:0f". Returns null for broadcast/multicast/empty. */
export function normMac(raw) {
  const m = String(raw || '').match(MAC_RE);
  if (!m) return null;
  const mac = m[0].toLowerCase().split(/[:-]/).map((x) => x.padStart(2, '0')).join(':');
  if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') return null;
  if (parseInt(mac.slice(0, 2), 16) & 1) return null; // multicast
  return mac;
}

/**
 * Phones now use a made-up ("private" / "random") Wi-Fi address instead of their real one.
 * You can spot it: the second character of the address is 2, 6, A or E.
 */
export const isPrivateMac = (mac) => /^.[26ae]/i.test(mac || '');

/** macOS / BSD: `arp -an` → "? (192.168.1.23) at 3c:22:fb:1:2:3 on en0 ifscope [ethernet]" */
export function parseArpBsd(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const ip = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/)?.[1];
    if (!ip || /incomplete/i.test(line)) continue;
    const mac = normMac(line.split(' at ')[1]);
    if (mac) out.push({ ip, mac, iface: line.match(/ on (\S+)/)?.[1] || '' });
  }
  return out;
}

/** Linux: `ip -4 neigh` → "192.168.1.23 dev wlan0 lladdr 3c:22:fb:01:02:03 REACHABLE". FAILED/INCOMPLETE are skipped. */
export function parseIpNeigh(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const ip = line.match(/^(\d+\.\d+\.\d+\.\d+)\s/)?.[1];
    if (!ip || /FAILED|INCOMPLETE/.test(line)) continue;
    const mac = normMac(line.match(/lladdr (\S+)/)?.[1]);
    if (mac) out.push({ ip, mac, iface: line.match(/dev (\S+)/)?.[1] || '', state: line.trim().split(/\s+/).at(-1) });
  }
  return out;
}

/** Linux fallback: /proc/net/arp (flags 0x2 = complete). */
export function parseProcArp(text) {
  return String(text).split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6 && c[2] !== '0x0')
    .map(([ip, , , mac, , iface]) => ({ ip, mac: normMac(mac), iface })).filter((x) => x.mac);
}

/** Windows: `arp -a` → "  192.168.1.23          3c-22-fb-01-02-03     dynamic" */
export function parseArpWindows(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+(\S+)\s+(dynamic|static)/i);
    if (!m || /static/i.test(m[3])) continue;
    const mac = normMac(m[2]);
    if (mac) out.push({ ip: m[1], mac, iface: '' });
  }
  return out;
}

/** All host addresses in a small network (e.g. 192.168.1.0/24 → .1 to .254). Capped so a big network isn't flooded. */
export function hostsIn(address, netmask, cap = 1024) {
  const toInt = (ip) => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
  const toIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
  const mask = toInt(netmask), base = toInt(address) & mask;
  const size = (~mask >>> 0) + 1;
  if (size > cap + 2) return hostsIn(address, '255.255.255.0', cap); // just this /24
  const out = [];
  for (let i = 1; i < size - 1; i++) out.push(toIp((base + i) >>> 0));
  return out;
}

/**
 * Who's home. A person is home if any of their devices was seen within the grace period
 * (phones drop off Wi-Fi when asleep, so a short gap doesn't mean they left).
 * Returns [{ id, home, lastSeen, changed }].
 */
export function presence(people, devices, now, graceMin = 15) {
  return people.map((p) => {
    const mine = devices.filter((d) => d.personId === p.id && !d.ignored);
    const lastSeen = Math.max(0, ...mine.map((d) => d.lastSeen || 0)) || null;
    const home = !!lastSeen && now - lastSeen <= graceMin * 60000;
    return { id: p.id, home, lastSeen, changed: home !== !!p.home };
  });
}
