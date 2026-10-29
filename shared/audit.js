// AUDIT LOG: every sign-in and every change, in order, as a hash chain. Each entry stores the hash of
// the one before it, so editing or deleting any entry breaks the chain from that point — and the
// Audit screen says exactly where. There is no way in SENTINEL to edit or delete entries.
import { sha256 } from './crypto.js';
import { canonical } from './canonical.js';

export const GENESIS = '0'.repeat(64);
/** The hash of an entry (everything except its own hash). */
export const entryHash = (e) => sha256(canonical({ seq: e.seq, ts: e.ts, who: e.who, role: e.role, via: e.via, action: e.action, target: e.target, detail: e.detail, ok: e.ok, prev: e.prev }));

/** Make the next entry after `last` (or the anchor). */
export function nextEntry(last, anchor, { ts, who, role, via, action, target = '', detail = '', ok = true }) {
  const e = { seq: (last?.seq ?? anchor?.seq ?? 0) + 1, ts, who: String(who || '?').slice(0, 40), role: String(role || '').slice(0, 10), via: String(via || '').slice(0, 40), action: String(action).slice(0, 60), target: String(target).slice(0, 120), detail: String(detail).slice(0, 300), ok: !!ok, prev: last?.hash ?? anchor?.hash ?? GENESIS };
  e.hash = entryHash(e);
  return e;
}

/** Check the chain. entries oldest first; anchor = { seq, hash } of the last trimmed entry (if any). */
export function verifyChain(entries, anchor = null) {
  let prev = anchor?.hash ?? GENESIS, seq = anchor?.seq ?? 0;
  for (const e of entries) {
    if (e.seq !== seq + 1) return { ok: false, at: e.seq, why: `Entry ${seq + 1} is missing (next is ${e.seq}).` };
    if (e.prev !== prev) return { ok: false, at: e.seq, why: `Entry ${e.seq} doesn’t follow on from entry ${seq}.` };
    if (entryHash(e) !== e.hash) return { ok: false, at: e.seq, why: `Entry ${e.seq} has been changed since it was written.` };
    prev = e.hash; seq = e.seq;
  }
  return { ok: true, count: entries.length, last: seq };
}
