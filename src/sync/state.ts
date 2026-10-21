// What syncs between a TV and its paired phones, as keyed entries (see ./doc):
//   fav:<id>  saved title            hist:<id>  history (when played)
//   prog:<id> playback position      coll:<id>  collection {n: name, i: item ids}
//   wish:<kind:tmdbId> wishlist      src:<id>   a source and whether it is connected
//   srv:<id>  media server           mus:<id>   music instance
//   set:<name> an app setting that isn't about this device
// General sources and servers only, never accounts, keys, the PIN, 18+ state or this
// device's own settings. Pure.
import type { Source } from "../domain/content";
import { persistableUrl } from "../domain/urls";
import {
  canPersistServer,
  validateServer,
  type MediaServer,
} from "../domain/servers";
import { cleanWish, MAX_WISHES, wishKey, type Wish } from "../domain/wishlist";
import type { MusicProvider } from "../music/types";
import { validateMusicProvider } from "../persistence/music";
import type { NamedCollection, UserState } from "../persistence/user-state";
import type { Snapshot } from "./doc";

export interface SyncState {
  user: Pick<
    UserState,
    "favorites" | "wishlist" | "collections" | "history" | "progress"
  >;
  sources: Source[];
  servers: MediaServer[];
  music: MusicProvider[];
  lookups: boolean;
}
// A source as synced: built-in and extension lists by id and whether they are
// connected; your own playlists in full.
export interface SourceValue {
  on: boolean;
  name?: string;
  url?: string;
  desc?: string;
  hours?: number;
}
// Opaque ids, and titles found on your servers by TMDB id (embed:movie:603).
const ID =
  /^(?:ot-[a-z0-9]+|embed:(?:movie|series):\d{1,9}(?::s\d{1,5}e\d{1,5})?)$/;
const SOURCE_ID = /^[A-Za-z0-9_.-]{1,100}$/;
const WEEK = 7 * 24 * 3600;
const kindOf = (key: string) => key.slice(0, key.indexOf(":"));
const idOf = (key: string) => key.slice(key.indexOf(":") + 1);
const synced = (s: Source) =>
  s.classification === "general" &&
  s.kind !== "xtream" &&
  s.kind !== "library" &&
  SOURCE_ID.test(s.id);
const ownPlaylist = (s: Source, builtIn: ReadonlyMap<string, boolean>) =>
  !builtIn.has(s.id) &&
  !s.extension &&
  s.kind === "m3u" &&
  !!s.url &&
  persistableUrl(s.url);

// `builtIn`: the app's own lists and whether each ships connected.
export function snapshot(
  state: SyncState,
  builtIn: ReadonlyMap<string, boolean>,
): Snapshot {
  const values: Record<string, unknown> = {};
  const defaults = new Set<string>();
  const { user } = state;
  for (const id of user.favorites) values[`fav:${id}`] = 1;
  for (const wish of user.wishlist) {
    const clean = cleanWish(wish);
    if (clean) values[`wish:${wishKey(clean)}`] = clean;
  }
  for (const c of user.collections)
    values[`coll:${c.id}`] = { n: c.name, i: c.itemIds };
  for (const h of user.history) values[`hist:${h.id}`] = h.at;
  for (const [id, seconds] of Object.entries(user.progress))
    values[`prog:${id}`] = Math.floor(seconds);
  for (const s of state.sources) {
    if (!synced(s)) continue;
    const key = `src:${s.id}`;
    if (ownPlaylist(s, builtIn))
      values[key] = {
        on: s.enabled,
        name: s.name,
        url: s.url,
        desc: s.description,
        hours: s.refreshHours,
      } satisfies SourceValue;
    else if (builtIn.has(s.id) || s.extension) {
      values[key] = { on: s.enabled } satisfies SourceValue;
      if (s.enabled === (builtIn.get(s.id) ?? false)) defaults.add(key);
    }
  }
  for (const server of state.servers) {
    const clean = validateServer(server);
    if (clean?.classification === "general" && canPersistServer(clean))
      values[`srv:${clean.id}`] = clean;
  }
  for (const provider of state.music) {
    const clean = validateMusicProvider(provider);
    if (clean) values[`mus:${clean.id}`] = clean;
  }
  values["set:lookups"] = state.lookups;
  if (state.lookups) defaults.add("set:lookups");
  return {
    values,
    defaults,
    // A list this device hasn't loaded (an extension it doesn't have) isn't removed.
    keep: (key, value) => kindOf(key) === "src" && !(value as SourceValue).url,
  };
}

const ids = (value: unknown, max: number) =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string" && ID.test(v))
        .slice(0, max)
    : null;
const text = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\p{Cc}]/gu, "")
        .trim()
        .slice(0, max)
    : "";

// Checks a value from the other device; undefined when it can't be used here. Only
// general entries pass: 18+ stays on the device that shows it.
export function cleanValue(key: string, value: unknown): unknown {
  const id = idOf(key);
  if (value === null)
    return [
      "fav",
      "hist",
      "prog",
      "coll",
      "wish",
      "src",
      "srv",
      "mus",
    ].includes(kindOf(key))
      ? null
      : undefined;
  switch (kindOf(key)) {
    case "fav":
      return ID.test(id) ? 1 : undefined;
    case "hist":
      return ID.test(id) &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
        ? value
        : undefined;
    case "prog":
      return ID.test(id) &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
        ? Math.floor(Math.min(value, WEEK))
        : undefined;
    case "coll": {
      const v = value as Record<string, unknown>;
      const name = text(v?.n, 80);
      const items = ids(v?.i, 10000);
      return ID.test(id) && name && items ? { n: name, i: items } : undefined;
    }
    case "wish": {
      const wish = cleanWish(value);
      return wish && wishKey(wish) === id ? wish : undefined;
    }
    case "src": {
      const v = value as Record<string, unknown>;
      if (!SOURCE_ID.test(id) || typeof v?.on !== "boolean") return undefined;
      if (v.url === undefined) return { on: v.on };
      const name = text(v.name, 100);
      if (typeof v.url !== "string" || !name || !persistableUrl(v.url))
        return undefined;
      return {
        on: v.on,
        name,
        url: v.url,
        desc: text(v.desc, 1000) || "Your playlist",
        hours: Math.max(1, Math.min(24 * 30, Number(v.hours) || 24)),
      } satisfies SourceValue;
    }
    case "srv": {
      const server = validateServer(value);
      return server &&
        server.id === id &&
        server.classification === "general" &&
        canPersistServer(server)
        ? server
        : undefined;
    }
    case "mus": {
      const provider = validateMusicProvider(value);
      return provider && provider.id === id ? provider : undefined;
    }
    case "set":
      return id === "lookups" && typeof value === "boolean" ? value : undefined;
    default:
      return undefined;
  }
}

// The library part of a set of changes, applied to the profile.
export function applyToUser<T extends SyncState["user"]>(
  user: T,
  changes: Record<string, unknown>,
): T {
  let { favorites, wishlist, collections, history } = user;
  let progress = user.progress;
  const touched = new Set<string>();
  for (const [key, value] of Object.entries(changes)) {
    const id = idOf(key);
    switch (kindOf(key)) {
      case "fav":
        if (value === null) favorites = favorites.filter((f) => f !== id);
        else if (!favorites.includes(id)) favorites = [...favorites, id];
        touched.add("fav");
        break;
      case "wish":
        wishlist = wishlist.filter((w) => wishKey(w) !== id);
        if (value !== null) wishlist = [value as Wish, ...wishlist];
        touched.add("wish");
        break;
      case "coll": {
        const v = value as { n: string; i: string[] } | null;
        const at = collections.findIndex((c) => c.id === id);
        const next: NamedCollection | null = v
          ? { id, name: v.n, itemIds: v.i }
          : null;
        collections =
          at < 0
            ? next
              ? [...collections, next]
              : collections
            : next
              ? collections.map((c, i) => (i === at ? next : c))
              : collections.filter((c) => c.id !== id);
        touched.add("coll");
        break;
      }
      case "hist":
        history = history.filter((h) => h.id !== id);
        if (value !== null) history = [...history, { id, at: value as number }];
        touched.add("hist");
        break;
      case "prog":
        progress = { ...progress };
        if (value === null) delete progress[id];
        else progress[id] = value as number;
        break;
    }
  }
  if (!touched.size && progress === user.progress) return user;
  return {
    ...user,
    favorites: favorites.slice(0, 10000),
    wishlist: wishlist.slice(0, MAX_WISHES),
    collections: collections.slice(0, 100),
    history: touched.has("hist")
      ? [...history].sort((a, b) => b.at - a.at).slice(0, 100)
      : history,
    progress,
  };
}

// A playlist definition as a source, for the catalog.
export function sourceFrom(id: string, value: SourceValue): Source | null {
  if (!value.url || !value.name) return null;
  return {
    id,
    name: value.name,
    url: value.url,
    kind: "m3u",
    classification: "general",
    enabled: value.on,
    description: value.desc || "Your playlist",
    refreshHours: value.hours || 24,
  };
}
