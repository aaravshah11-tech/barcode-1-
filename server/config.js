// HQ settings: where data lives, which ports to use, and this computer's network addresses.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.resolve(process.env.SENTINEL_DATA || path.join(ROOT, 'data'));
export const CERT_DIR = path.join(DATA_DIR, 'certs');

/** HTTPS for the dashboard and Agents; plain HTTP only for the "trust this HQ" setup page. */
export const HTTPS_PORT = Number(process.env.SENTINEL_HTTPS_PORT || 8443);
export const HTTP_PORT = Number(process.env.SENTINEL_HTTP_PORT || 8080);
export const HOST = process.env.SENTINEL_HOST || '0.0.0.0';

const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);

/** This computer's IPv4 addresses on the home network (Wi-Fi/Ethernet first, Tailscale 100.x last). */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivate(a.address)) continue;
      out.push({ name, address: a.address, tailscale: a.address.startsWith('100.') || /tailscale|utun/i.test(name) });
    }
  }
  return out.sort((a, b) => a.tailscale - b.tailscale);
}

/** The address phones should use (override with SENTINEL_PUBLIC_IP if the guess is wrong). */
export function mainAddress() {
  return process.env.SENTINEL_PUBLIC_IP || lanAddresses().find((a) => !a.tailscale)?.address || '127.0.0.1';
}

export const hostName = () => os.hostname().replace(/\.local$/i, '');
