import { computed, signal } from "@preact/signals";
import type { MediaRef } from "../core/module";

// Hash routes, so the app runs from any static host (and the Android host) and every screen
// has an address that survives a refresh and can be shared.
//
//   #/                         home
//   #/s/<section>              a module's section (movies, tv)
//   #/list                     My List
//   #/search/<text>            search
//   #/remote  #/setup          the TV remote, setup
//   #/t/<mod>/<kind>/<id>      a title page
//   #/w/<mod>/<kind>/<id>[/<season>/<episode>]   watching in this browser
export type Route =
  | { name: "home" }
  | { name: "section"; id: string }
  | { name: "list" }
  | { name: "search"; q: string }
  | { name: "remote" }
  | { name: "setup" }
  | { name: "title"; mod: string; kind: string; id: string }
  | { name: "watch"; mod: string; kind: string; id: string; season?: number; episode?: number };

export const hash = signal(location.hash);
if (typeof window !== "undefined") window.addEventListener("hashchange", () => (hash.value = location.hash));

const SEG = /^[A-Za-z0-9_-]{1,100}$/;
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
};

export function parseRoute(h: string): Route {
  const parts = h.replace(/^#\/?/, "").split("/").map(dec);
  switch (parts[0]) {
    case "s":
      return SEG.test(parts[1] ?? "") ? { name: "section", id: parts[1] } : { name: "home" };
    case "list":
      return { name: "list" };
    case "search":
      return { name: "search", q: parts.slice(1).join("/").slice(0, 100) };
    case "remote":
      return { name: "remote" };
    case "setup":
      return { name: "setup" };
    case "t":
      return SEG.test(parts[1] ?? "") && SEG.test(parts[2] ?? "") && SEG.test(parts[3] ?? "")
        ? { name: "title", mod: parts[1], kind: parts[2], id: parts[3] }
        : { name: "home" };
    case "w": {
      if (!(SEG.test(parts[1] ?? "") && SEG.test(parts[2] ?? "") && SEG.test(parts[3] ?? ""))) return { name: "home" };
      const season = Number(parts[4]);
      const episode = Number(parts[5]);
      return {
        name: "watch", mod: parts[1], kind: parts[2], id: parts[3],
        ...(Number.isInteger(season) && Number.isInteger(episode) && parts[4] !== undefined ? { season, episode } : {}),
      };
    }
    default:
      return { name: "home" };
  }
}

export const route = computed(() => parseRoute(hash.value));

export const titlePath = (ref: Pick<MediaRef, "mod" | "kind" | "id">) =>
  `#/t/${ref.mod}/${ref.kind === "episode" ? "tv" : ref.kind}/${ref.id}`;
export const watchPath = (ref: MediaRef) =>
  `#/w/${ref.mod}/${ref.kind === "episode" ? "episode" : ref.kind}/${ref.id}` +
  (ref.kind === "episode" ? `/${ref.season}/${ref.episode}` : "");
export const searchPath = (q: string) => `#/search/${encodeURIComponent(q)}`;

export function go(path: string) {
  if (location.hash === path) hash.value = path;
  else location.hash = path;
}
// Changes the address without adding a history entry (the next episode, a corrected link).
export function replace(path: string) {
  try {
    history.replaceState(null, "", location.pathname + location.search + path);
  } catch {
    location.replace(path);
  }
  hash.value = path;
}
export const back = (fallback = "#/") => {
  // Arrived by a link with nothing to go back to: go somewhere sensible instead.
  if (history.length > 1) history.back();
  else go(fallback);
};

// A ref good enough to ask its module for details, from an address.
export function refFromRoute(r: Extract<Route, { name: "title" | "watch" }>): MediaRef {
  const base = { mod: r.mod, kind: r.kind, id: r.id, title: "" };
  return r.name === "watch" && r.kind === "episode" && r.season !== undefined
    ? { ...base, season: r.season, episode: r.episode }
    : base;
}
