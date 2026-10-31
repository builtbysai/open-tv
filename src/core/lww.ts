// Last-writer-wins state shared by a TV and its phones: servers, the TMDB key, preferences,
// My List and playback positions. Each key holds [time, value]; a null value is a removal
// kept as a tombstone, so a delete on one device is not undone by another that still has
// the old entry. Pure functions: both sides merge the same way and converge.

export type Entry = [number, unknown];
export type Doc = Record<string, Entry>;

export const TOMBSTONE_MS = 30 * 24 * 3600 * 1000;
export const MAX_ENTRIES = 2000;

export function put(doc: Doc, key: string, value: unknown, now: number): Doc {
  return { ...doc, [key]: [now, value] };
}
export const remove = (doc: Doc, key: string, now: number): Doc =>
  put(doc, key, null, now);

// Newer wins. Equal times settle by comparing the serialized values, so both sides pick the
// same winner without talking.
function newer(a: Entry | undefined, b: Entry): boolean {
  if (!a) return true;
  if (b[0] !== a[0]) return b[0] > a[0];
  return JSON.stringify(b[1]) > JSON.stringify(a[1]);
}

export function merge(local: Doc, remote: Doc): { doc: Doc; changed: string[] } {
  const doc: Doc = { ...local };
  const changed: string[] = [];
  for (const key of Object.keys(remote)) {
    if (newer(doc[key], remote[key])) {
      doc[key] = remote[key];
      changed.push(key);
    }
  }
  return { doc, changed };
}

// What `remote` lacks or has older than `local`: the reply to a full document.
export function missingFrom(local: Doc, remote: Doc): Doc {
  const out: Doc = {};
  for (const key of Object.keys(local))
    if (newer(remote[key], local[key]) && !sameEntry(remote[key], local[key]))
      out[key] = local[key];
  return out;
}
const sameEntry = (a: Entry | undefined, b: Entry) =>
  !!a && a[0] === b[0] && JSON.stringify(a[1]) === JSON.stringify(b[1]);

export function prune(doc: Doc, now: number): Doc {
  const out: Doc = {};
  for (const key of Object.keys(doc)) {
    const [time, value] = doc[key];
    if (value === null && now - time > TOMBSTONE_MS) continue;
    out[key] = doc[key];
  }
  const keys = Object.keys(out);
  if (keys.length <= MAX_ENTRIES) return out;
  // Over the cap: drop the oldest tombstones, then the oldest entries.
  keys.sort((a, b) => out[a][0] - out[b][0]);
  for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete out[key];
  return out;
}

export function parseDoc(value: unknown): Doc | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Doc = {};
  const keys = Object.keys(value as object);
  if (keys.length > MAX_ENTRIES * 2) return null;
  for (const key of keys) {
    const entry = (value as Record<string, unknown>)[key];
    if (
      !/^[a-z]{2,6}:[A-Za-z0-9_.:-]{1,200}$/.test(key) ||
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "number" ||
      !Number.isFinite(entry[0]) ||
      entry[0] < 0
    )
      return null;
    out[key] = [entry[0], entry[1]];
  }
  return out;
}
