import { useSyncExternalStore } from "react";
// The TVs this phone (or computer) is paired with. The token is this device's own
// credential for that TV; revoking it on either side ends the pairing.
export interface Pairing {
  tvId: string;
  controllerId: string;
  token: string;
  name: string;
  pairedAt: number;
}
const KEY = "opentv:paired-tvs:v1";
const ACTIVE = "opentv:active-tv:v1";
const ID = /^[A-Za-z0-9_-]{8,64}$/;
function read(): { list: Pairing[]; active: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    const list = (Array.isArray(raw) ? raw : [])
      .filter(
        (p): p is Pairing =>
          !!p &&
          ID.test(p.tvId) &&
          ID.test(p.controllerId) &&
          ID.test(p.token) &&
          typeof p.name === "string",
      )
      .slice(0, 20);
    const active = localStorage.getItem(ACTIVE) || "";
    return {
      list,
      active: list.some((p) => p.tvId === active)
        ? active
        : (list[0]?.tvId ?? ""),
    };
  } catch {
    return { list: [], active: "" };
  }
}
let current = read();
const listeners = new Set<() => void>();
function write(next: { list: Pairing[]; active: string }) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next.list));
    localStorage.setItem(ACTIVE, next.active);
  } catch {
    /* Kept for this visit. */
  }
  for (const listener of listeners) listener();
}
export const pairings = {
  get: () => current,
  add(pairing: Pairing) {
    const list = [
      pairing,
      ...current.list.filter((p) => p.tvId !== pairing.tvId),
    ];
    write({ list, active: pairing.tvId });
  },
  remove(tvId: string) {
    const list = current.list.filter((p) => p.tvId !== tvId);
    write({
      list,
      active: current.active === tvId ? (list[0]?.tvId ?? "") : current.active,
    });
  },
  rename(tvId: string, name: string) {
    const clean = name
      .replace(/[\p{Cc}]/gu, "")
      .trim()
      .slice(0, 60);
    if (!clean) return;
    write({
      ...current,
      list: current.list.map((p) =>
        p.tvId === tvId ? { ...p, name: clean } : p,
      ),
    });
  },
  choose(tvId: string) {
    if (current.list.some((p) => p.tvId === tvId))
      write({ ...current, active: tvId });
  },
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === ACTIVE) {
      current = read();
      listener();
    }
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
};
export function usePairings() {
  return useSyncExternalStore(subscribe, pairings.get, pairings.get);
}
