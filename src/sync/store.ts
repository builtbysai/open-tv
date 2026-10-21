import { useSyncExternalStore } from "react";
import type { SyncDoc, SyncEntry } from "./doc";

// This profile's sync document, kept so changes made while the other device is away
// are sent when they meet again.
const docKey = (profileId: string) => `opentv:sync:v1:${profileId}`;
export function readDoc(profileId: string): SyncDoc | null {
  try {
    const raw = JSON.parse(localStorage.getItem(docKey(profileId)) || "null");
    if (raw?.v !== 1 || !raw.e || typeof raw.e !== "object") return null;
    const e: Record<string, SyncEntry> = {};
    for (const [key, entry] of Object.entries(raw.e))
      if (Array.isArray(entry) && typeof entry[0] === "number")
        e[key] = [entry[0], entry[1] ?? null];
    return { v: 1, e };
  } catch {
    return null;
  }
}
export function writeDoc(profileId: string, doc: SyncDoc) {
  try {
    localStorage.setItem(docKey(profileId), JSON.stringify(doc));
  } catch {
    /* Kept in memory for this visit. */
  }
}
// The same, as it is sent (compacted, 18+ titles left out), for the pairing page to
// send right after pairing.
const OUTGOING = "opentv:sync-out:v1";
export function writeOutgoing(doc: SyncDoc) {
  try {
    localStorage.setItem(OUTGOING, JSON.stringify(doc));
  } catch {
    /* The app sends it when it opens. */
  }
}
export function readOutgoing(): SyncDoc | null {
  try {
    const doc = JSON.parse(localStorage.getItem(OUTGOING) || "null");
    return doc?.v === 1 && doc.e && typeof doc.e === "object" ? doc : null;
  } catch {
    return null;
  }
}

// The one quiet line in Settings → This device: when this device last synced, or that
// syncing stopped because a pairing was removed.
export interface SyncStatus {
  at: number;
  peer: string;
  stopped?: boolean;
}
const STATUS = "opentv:sync-status:v1";
function readStatus(): SyncStatus | null {
  try {
    const value = JSON.parse(localStorage.getItem(STATUS) || "null");
    return value &&
      typeof value.at === "number" &&
      typeof value.peer === "string"
      ? {
          at: value.at,
          peer: value.peer.slice(0, 60),
          stopped: value.stopped === true,
        }
      : null;
  } catch {
    return null;
  }
}
let status = readStatus();
const listeners = new Set<() => void>();
function setStatus(next: SyncStatus) {
  status = next;
  try {
    localStorage.setItem(STATUS, JSON.stringify(next));
  } catch {
    /* For this visit. */
  }
  for (const listener of listeners) listener();
}
export const syncStatus = {
  get: () => status,
  synced: (peer: string) => setStatus({ at: Date.now(), peer }),
  stopped: (peer: string) => setStatus({ at: Date.now(), peer, stopped: true }),
};
export function useSyncStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncStatus.get,
    syncStatus.get,
  );
}
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function statusLine(value: SyncStatus | null, tv: boolean): string {
  if (!value) return "";
  if (value.stopped) return `${value.peer} was removed. Syncing stopped.`;
  return tv
    ? `Synced from your phone · ${time(value.at)}`
    : `Synced with ${value.peer} · ${time(value.at)}`;
}
