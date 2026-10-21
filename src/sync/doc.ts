// A sync document: keyed entries, each holding the latest value and when it was set.
// Two paired devices exchange these and merge them last-writer-wins per key. A null
// value is a tombstone (the item was removed); absence never means removal.
// Pure: no storage, no clock, no app types.
import type { SyncDoc, SyncEntry } from "../remote/protocol";
export type { SyncDoc, SyncEntry };

export const emptyDoc = (): SyncDoc => ({ v: 1, e: {} });
const DAY = 24 * 3600 * 1000;
export const TOMBSTONE_AGE = 30 * DAY;
export const MAX_TOMBSTONES = 500;

// Key order doesn't matter when comparing values.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
const same = (a: SyncEntry | undefined, b: SyncEntry | undefined) =>
  !!a && !!b && a[0] === b[0] && canonical(a[1]) === canonical(b[1]);

// Whether `a` beats `b`. Ties are settled the same way on every device: a live value
// beats a tombstone, then the larger value wins.
export function wins(a: SyncEntry, b: SyncEntry): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if ((a[1] === null) !== (b[1] === null)) return a[1] !== null;
  return canonical(a[1]) > canonical(b[1]);
}

export interface Snapshot {
  // Current values by key.
  values: Record<string, unknown>;
  // Keys whose value is just the app's default (a built-in list left as shipped): they
  // never outrank a choice the other device made.
  defaults?: ReadonlySet<string>;
  // Keys that may be missing here without having been removed (an extension list this
  // device hasn't loaded): no tombstone for them.
  keep?: (key: string, value: unknown) => boolean;
}

// Records local changes: compares the current values with the last document and gives
// each new or changed value the time `now`, and each removed one a tombstone. With no
// earlier document (`first`), what is already here counts as older than any choice made
// after it: defaults at 0, the rest at 1.
export function stamp(
  prev: SyncDoc,
  snapshot: Snapshot,
  now: number,
  first = false,
): { doc: SyncDoc; changed: string[] } {
  const e: Record<string, SyncEntry> = {};
  const changed: string[] = [];
  const defaults = snapshot.defaults ?? new Set<string>();
  for (const [key, value] of Object.entries(snapshot.values)) {
    const old = prev.e[key];
    if (old && old[1] !== null && canonical(old[1]) === canonical(value)) {
      e[key] = old;
      continue;
    }
    const t = first
      ? defaults.has(key)
        ? 0
        : 1
      : !old && defaults.has(key)
        ? 0
        : Math.max(now, (old?.[0] ?? 0) + 1);
    e[key] = [t, value];
    changed.push(key);
  }
  for (const [key, old] of Object.entries(prev.e)) {
    if (key in e) continue;
    if (old[1] === null || snapshot.keep?.(key, old[1])) e[key] = old;
    else {
      e[key] = [Math.max(now, old[0] + 1), null];
      changed.push(key);
    }
  }
  return { doc: prune({ v: 1, e }, now), changed };
}

// Merges another device's document into this one's. `changed` lists the keys whose
// value here changes (to apply to the app), `behind` the keys the other side lacks or
// has older (to send back after a full document).
export function merge(
  local: SyncDoc,
  remote: SyncDoc,
): { doc: SyncDoc; changed: string[]; behind: string[] } {
  const e: Record<string, SyncEntry> = { ...local.e };
  const changed: string[] = [];
  for (const [key, theirs] of Object.entries(remote.e)) {
    const ours = e[key];
    if (!ours || wins(theirs, ours)) {
      if (!same(ours, theirs)) changed.push(key);
      e[key] = theirs;
    }
  }
  const behind = Object.keys(e).filter((key) => !same(e[key], remote.e[key]));
  return { doc: { v: 1, e }, changed, behind };
}

// Tombstones are kept for 30 days and at most 500 of them, newest first.
export function prune(doc: SyncDoc, now: number): SyncDoc {
  const tombs = Object.entries(doc.e)
    .filter(([, entry]) => entry[1] === null)
    .sort((a, b) => b[1][0] - a[1][0]);
  const drop = tombs
    .filter(
      ([, entry], i) => i >= MAX_TOMBSTONES || now - entry[0] > TOMBSTONE_AGE,
    )
    .map(([key]) => key);
  if (!drop.length) return doc;
  const e = { ...doc.e };
  for (const key of drop) delete e[key];
  return { v: 1, e };
}

export const pick = (doc: SyncDoc, keys: Iterable<string>): SyncDoc => {
  const e: Record<string, SyncEntry> = {};
  for (const key of keys) if (doc.e[key]) e[key] = doc.e[key];
  return { v: 1, e };
};

// Caps per kind of entry, newest first, for what is sent.
export const SEND_LIMITS: Record<string, number> = {
  hist: 100,
  prog: 300,
  fav: 2000,
  coll: 100,
  wish: 300,
};
// What goes over the wire: hidden keys left out, each kind capped, and the whole kept
// under `maxBytes` by dropping tombstones and then the oldest entries.
export function compact(
  doc: SyncDoc,
  maxBytes: number,
  hide: (key: string) => boolean = () => false,
): SyncDoc {
  const groups = new Map<string, [string, SyncEntry][]>();
  for (const [key, entry] of Object.entries(doc.e)) {
    if (hide(key)) continue;
    const kind = key.slice(0, key.indexOf(":"));
    groups.set(kind, [...(groups.get(kind) ?? []), [key, entry]]);
  }
  const list: [string, SyncEntry][] = [];
  for (const [kind, entries] of groups) {
    entries.sort((a, b) => b[1][0] - a[1][0]);
    const live = entries.filter(([, entry]) => entry[1] !== null);
    const tombs = entries.filter(([, entry]) => entry[1] === null);
    list.push(...live.slice(0, SEND_LIMITS[kind] ?? 1000), ...tombs);
  }
  const size = (entries: [string, SyncEntry][]) =>
    JSON.stringify(Object.fromEntries(entries)).length;
  if (size(list) > maxBytes) {
    // Oldest tombstones go first, then the oldest values.
    list.sort(
      (a, b) =>
        Number(a[1][1] === null) - Number(b[1][1] === null) ||
        b[1][0] - a[1][0],
    );
    let bytes = size(list);
    while (list.length && bytes > maxBytes) {
      const [key, entry] = list.pop()!;
      bytes -= JSON.stringify(key).length + JSON.stringify(entry).length + 2;
    }
  }
  return { v: 1, e: Object.fromEntries(list) };
}
