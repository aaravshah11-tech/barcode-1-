import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normMac, isPrivateMac, parseArpBsd, parseIpNeigh, parseProcArp, parseArpWindows, hostsIn, presence } from '../../server/recon-core.js';

test('MAC addresses: tidy, skip broadcast/multicast, spot private ones', () => {
  assert.equal(normMac('3C:22:FB:1:2:3'), '3c:22:fb:01:02:03');
  assert.equal(normMac('3c-22-fb-01-02-03'), '3c:22:fb:01:02:03');
  assert.equal(normMac('ff:ff:ff:ff:ff:ff'), null);
  assert.equal(normMac('01:00:5e:00:00:fb'), null);
  assert.equal(normMac('(incomplete)'), null);
  assert.ok(isPrivateMac('da:12:34:56:78:9a'));   // iPhone "Private Wi-Fi Address"
  assert.ok(isPrivateMac('a6:00:00:00:00:01'));
  assert.ok(!isPrivateMac('3c:22:fb:01:02:03'));  // a real (manufacturer) address
});

test('reading the ARP table on macOS, Linux and Windows', () => {
  const mac = `? (192.168.1.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]
? (192.168.1.23) at da:12:34:56:78:9a on en0 ifscope [ethernet]
? (192.168.1.40) at (incomplete) on en0 ifscope [ethernet]
? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]
? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]`;
  assert.deepEqual(parseArpBsd(mac).map((x) => [x.ip, x.mac]), [['192.168.1.1', '00:11:22:33:44:55'], ['192.168.1.23', 'da:12:34:56:78:9a']]);
  const neigh = `192.168.1.1 dev wlan0 lladdr 00:11:22:33:44:55 REACHABLE
192.168.1.23 dev wlan0 lladdr da:12:34:56:78:9a STALE
192.168.1.40 dev wlan0 FAILED
192.168.1.50 dev wlan0 INCOMPLETE`;
  assert.deepEqual(parseIpNeigh(neigh).map((x) => [x.ip, x.state]), [['192.168.1.1', 'REACHABLE'], ['192.168.1.23', 'STALE']]);
  const proc = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         00:11:22:33:44:55     *        wlan0
192.168.1.40     0x1         0x0         00:00:00:00:00:00     *        wlan0`;
  assert.deepEqual(parseProcArp(proc).map((x) => x.ip), ['192.168.1.1']);
  const win = `Interface: 192.168.1.10 --- 0xb
  Internet Address      Physical Address      Type
  192.168.1.1           00-11-22-33-44-55     dynamic
  192.168.1.23          da-12-34-56-78-9a     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static`;
  assert.deepEqual(parseArpWindows(win).map((x) => x.mac), ['00:11:22:33:44:55', 'da:12:34:56:78:9a']);
});

test('network addresses to scan', () => {
  const h = hostsIn('192.168.1.10', '255.255.255.0');
  assert.equal(h.length, 254);
  assert.equal(h[0], '192.168.1.1');
  assert.equal(h.at(-1), '192.168.1.254');
  assert.equal(hostsIn('10.0.5.9', '255.0.0.0').length, 254, 'huge network: only scan our own /24');
});

test('who’s home, with a grace period', () => {
  const now = Date.now(), MIN = 60000;
  const people = [{ id: 'a', home: false }, { id: 'b', home: true }, { id: 'c', home: true }];
  const devices = [
    { mac: '1', personId: 'a', lastSeen: now - 1 * MIN },
    { mac: '2', personId: 'b', lastSeen: now - 10 * MIN },  // phone asleep for 10 min: still home
    { mac: '3', personId: 'c', lastSeen: now - 40 * MIN },  // gone 40 min: left
    { mac: '4', personId: 'c', lastSeen: now, ignored: true },
  ];
  assert.deepEqual(presence(people, devices, now, 15).map((p) => [p.id, p.home, p.changed]), [['a', true, true], ['b', true, false], ['c', false, true]]);
});
