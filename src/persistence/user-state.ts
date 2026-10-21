import {
  emptyBrowse,
  gridLimit,
  libraryTab,
  type BrowseView,
  type LibraryView,
  type FormDrafts,
} from "../domain/view-state";
import { stableId, type Content } from "../domain/content";
import { sensitiveUrl } from "../domain/urls";
import { diagnose } from "../domain/errors";
import { cleanWish, MAX_WISHES, type Wish } from "../domain/wishlist";
export type Route =
  | "home"
  | "live"
  | "audio"
  | "music"
  | "movies"
  | "library"
  | "search"
  | "settings"
  | "legal";
export interface NamedCollection {
  id: string;
  name: string;
  itemIds: string[];
}
export interface UserState {
  version: 2;
  favorites: string[];
  // Titles you want that are not on your servers yet.
  wishlist: Wish[];
  collections: NamedCollection[];
  history: { id: string; at: number }[];
  progress: Record<string, number>;
  session: {
    route: Route;
    query: string;
    genre: string;
    scroll: Partial<Record<Route, number>>;
    views: Partial<Record<Route, BrowseView>>;
    library: LibraryView;
    drafts: FormDrafts;
    selectedId?: string;
    nowId?: string;
  };
  preferences: {
    volume: number;
    muted: boolean;
    pinHash?: string;
    pinSalt?: string;
  };
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const STORAGE_KEY = "opentv:user:v2";
const LEGACY_MIGRATED = "opentv:legacy-migrated:v1";
// The device PIN guards 18+ on this device whichever profile is open, so it is kept once
// per device, not per profile.
const DEVICE_PIN = "opentv:device-pin:v1";
function devicePin(saved: string | null, state: UserState) {
  try {
    // Not written yet (an older save): the profile's own PIN becomes the device's.
    if (saved === null) return;
    const value = JSON.parse(saved);
    delete state.preferences.pinHash;
    delete state.preferences.pinSalt;
    if (
      record(value) &&
      typeof value.hash === "string" &&
      /^[a-f0-9]{64}$/.test(value.hash) &&
      typeof value.salt === "string" &&
      /^[a-f0-9]{32}$/.test(value.salt)
    ) {
      state.preferences.pinHash = value.hash;
      state.preferences.pinSalt = value.salt;
    }
  } catch {
    diagnose("storage.invalid-json");
  }
}
export const routes: Route[] = [
  "home",
  "live",
  "audio",
  "music",
  "movies",
  "library",
  "search",
  "settings",
  "legal",
];
const defaults = (): UserState => ({
  version: 2,
  favorites: [],
  wishlist: [],
  collections: [],
  history: [],
  progress: {},
  session: {
    route: "home",
    query: "",
    genre: "",
    scroll: {},
    views: {},
    library: { tab: "saved", limit: 72 },
    drafts: {},
  },
  preferences: { volume: 1, muted: false },
});
function read(storage: StorageLike, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    diagnose("storage.invalid-json");
    return null;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
// Opaque content ids, and the ids of titles found on your servers by TMDB id
// (embed:movie:603, embed:series:1399:s1e2).
const ID =
  /^(?:ot-[a-z0-9]+|embed:(?:movie|series):\d{1,9}(?::s\d{1,5}e\d{1,5})?)$/;
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string" && ID.test(v))
        .slice(0, 10000)
    : [];
}
export function loadUserState(storage: StorageLike): UserState {
  // Read before a first save of this profile can write its own (empty) PIN.
  let pin: string | null = null;
  try {
    pin = storage.getItem(DEVICE_PIN);
  } catch {
    diagnose("storage.unavailable");
  }
  const state = loadProfileState(storage);
  devicePin(pin, state);
  return state;
}
function loadProfileState(storage: StorageLike): UserState {
  const state = defaults();
  const saved = read(storage, STORAGE_KEY);
  if (record(saved) && saved.version === 2) {
    state.favorites = ids(saved.favorites);
    if (Array.isArray(saved.wishlist))
      state.wishlist = saved.wishlist
        .map(cleanWish)
        .filter((w): w is Wish => w !== null)
        .slice(0, MAX_WISHES);
    if (Array.isArray(saved.collections))
      state.collections = saved.collections
        .filter(
          (v): v is NamedCollection =>
            record(v) &&
            ids([v.id]).length === 1 &&
            typeof v.name === "string" &&
            v.name.trim().length > 0,
        )
        .slice(0, 100)
        .map((v) => ({
          id: v.id,
          name: v.name.slice(0, 80),
          itemIds: ids(v.itemIds),
        }));
    if (Array.isArray(saved.history))
      state.history = saved.history
        .filter(
          (v): v is { id: string; at: number } =>
            record(v) &&
            ids([v.id]).length === 1 &&
            typeof v.at === "number" &&
            Number.isFinite(v.at),
        )
        .slice(0, 100);
    if (record(saved.progress))
      for (const [key, value] of Object.entries(saved.progress))
        if (
          ids([key]).length &&
          typeof value === "number" &&
          value >= 0 &&
          Number.isFinite(value)
        )
          state.progress[key] = value;
    if (record(saved.session)) {
      const s = saved.session;
      if (routes.includes(s.route as Route))
        state.session.route = s.route as Route;
      if (typeof s.query === "string")
        state.session.query = s.query.slice(0, 300);
      if (typeof s.genre === "string")
        state.session.genre = s.genre.slice(0, 100);
      if (record(s.views))
        for (const route of routes) {
          const view = s.views[route];
          if (record(view)) {
            state.session.views[route] = {
              genre:
                typeof view.genre === "string" ? view.genre.slice(0, 100) : "",
              language:
                typeof view.language === "string"
                  ? view.language.slice(0, 100)
                  : "",
              country:
                typeof view.country === "string"
                  ? view.country.slice(0, 100)
                  : "",
              limit: gridLimit(view.limit),
              guide: view.guide === true,
            };
          }
        }
      if (!state.session.views[state.session.route])
        state.session.views[state.session.route] = {
          ...emptyBrowse(),
          genre: state.session.genre,
        };
      if (record(s.library))
        state.session.library = {
          tab: libraryTab(s.library.tab),
          limit: gridLimit(s.library.limit),
        };
      if (record(s.drafts)) {
        const media = s.drafts.media;
        if (
          record(media) &&
          (media.classification === "general" ||
            media.classification === "adult") &&
          typeof media.title === "string" &&
          [
            "movie",
            "episode",
            "anime",
            "documentary",
            "radio",
            "audio",
            "live",
          ].includes(String(media.type))
        )
          state.session.drafts.media = {
            title: media.title.slice(0, 200),
            description:
              typeof media.description === "string"
                ? media.description.slice(0, 10000)
                : "",
            classification: media.classification,
            type: media.type as NonNullable<FormDrafts["media"]>["type"],
            serverId: ids([media.serverId])[0],
            providerItemId:
              typeof media.providerItemId === "string" &&
              /^[a-z0-9_-]{1,100}$/i.test(media.providerItemId)
                ? media.providerItemId
                : undefined,
            genres:
              typeof media.genres === "string"
                ? media.genres.slice(0, 1000)
                : undefined,
            languages:
              typeof media.languages === "string"
                ? media.languages.slice(0, 1000)
                : undefined,
            countries:
              typeof media.countries === "string"
                ? media.countries.slice(0, 1000)
                : undefined,
            year:
              typeof media.year === "number" &&
              Number.isInteger(media.year) &&
              media.year >= 1888 &&
              media.year <= 2200
                ? media.year
                : undefined,
            runtimeMinutes:
              typeof media.runtimeMinutes === "number" &&
              Number.isFinite(media.runtimeMinutes) &&
              media.runtimeMinutes > 0 &&
              media.runtimeMinutes <= 1440
                ? media.runtimeMinutes
                : undefined,
            series:
              typeof media.series === "string"
                ? media.series.slice(0, 200)
                : "",
            season:
              typeof media.season === "number" && Number.isFinite(media.season)
                ? Math.max(0, Math.min(10000, Math.floor(media.season)))
                : 1,
            episode:
              typeof media.episode === "number" &&
              Number.isFinite(media.episode)
                ? Math.max(1, Math.floor(media.episode))
                : 1,
          };
        const playlist = s.drafts.playlist;
        if (
          record(playlist) &&
          (playlist.classification === "general" ||
            playlist.classification === "adult") &&
          typeof playlist.name === "string"
        )
          state.session.drafts.playlist = {
            name: playlist.name.slice(0, 100),
            classification: playlist.classification,
          };
      }
      if (ids([s.selectedId]).length)
        state.session.selectedId = s.selectedId as string;
      if (ids([s.nowId]).length) state.session.nowId = s.nowId as string;
      if (record(s.scroll))
        for (const route of routes) {
          const y = s.scroll[route];
          if (typeof y === "number" && y >= 0 && Number.isFinite(y))
            state.session.scroll[route] = y;
        }
    }
    if (record(saved.preferences)) {
      const p = saved.preferences;
      if (typeof p.volume === "number" && Number.isFinite(p.volume))
        state.preferences.volume = Math.max(0, Math.min(1, p.volume));
      state.preferences.muted = p.muted === true;
      if (
        typeof p.pinHash === "string" &&
        /^[a-f0-9]{64}$/.test(p.pinHash) &&
        typeof p.pinSalt === "string" &&
        /^[a-f0-9]{32}$/.test(p.pinSalt)
      ) {
        state.preferences.pinHash = p.pinHash;
        state.preferences.pinSalt = p.pinSalt;
      }
    }
    return state;
  }
  // Data from before profiles is moved once, into the first profile that opens; a profile
  // added later starts empty instead of inheriting it.
  let migrated = false;
  try {
    migrated = storage.getItem(LEGACY_MIGRATED) === "1";
    storage.setItem(LEGACY_MIGRATED, "1");
  } catch {
    diagnose("storage.unavailable");
  }
  if (migrated) {
    saveUserState(storage, state);
    return state;
  }
  // URL keys become opaque IDs. Do not copy titles, artwork, account URLs or adult activity.
  const favorites = read(storage, "opentv_favs");
  if (Array.isArray(favorites))
    state.favorites = favorites
      .filter((v): v is string => typeof v === "string" && !sensitiveUrl(v))
      .map(stableId);
  const recent = read(storage, "opentv_recent");
  if (Array.isArray(recent))
    state.history = recent
      .filter(
        (v) => record(v) && typeof v.url === "string" && !sensitiveUrl(v.url),
      )
      .map((v) => ({ id: stableId((v as { url: string }).url), at: 0 }));
  const resume = read(storage, "ot_resume");
  if (record(resume))
    for (const [url, pos] of Object.entries(resume))
      if (
        !sensitiveUrl(url) &&
        typeof pos === "number" &&
        pos >= 0 &&
        Number.isFinite(pos)
      )
        state.progress[stableId(url)] = pos;
  const oldSession = read(storage, "ot_session");
  if (record(oldSession)) {
    const mapping: Record<string, Route> = {
      watch: "live",
      movies: "movies",
      srv: "library",
      xt: "settings",
    };
    state.session.route = mapping[String(oldSession.tab)] || "home";
    // Form, filter and search data stays in this blob so older saves keep loading.
    // Strip the unsafe playback URL without discarding the rest of the old session.
    try {
      storage.setItem(
        "ot_session",
        JSON.stringify({ ...oldSession, now: null }),
      );
    } catch {
      diagnose("storage.write-failed");
    }
  }
  try {
    const volume = Number(storage.getItem("ot_volume") ?? "1");
    if (Number.isFinite(volume))
      state.preferences.volume = Math.max(0, Math.min(1, volume));
    state.preferences.muted = storage.getItem("ot_muted") === "1";
  } catch {
    diagnose("storage.unavailable");
  }
  state.session.views[state.session.route] = {
    ...emptyBrowse(),
    genre: state.session.genre,
  };
  saveUserState(storage, state);
  return state;
}
export function saveUserState(storage: StorageLike, state: UserState): boolean {
  try {
    const { pinHash, pinSalt } = state.preferences;
    storage.setItem(
      DEVICE_PIN,
      pinHash && pinSalt
        ? JSON.stringify({ hash: pinHash, salt: pinSalt })
        : "null",
    );
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    diagnose("storage.write-failed");
    return false;
  }
}
export function contentAliases(item: Content): string[] {
  return [
    item.id,
    ...(item.aliases || []),
    ...item.streams.map((s) => stableId(s.url)),
  ];
}
export function hasFavorite(state: UserState, item: Content) {
  return contentAliases(item).some((id) => state.favorites.includes(id));
}
export function progressFor(state: UserState, item: Content) {
  return Math.max(
    0,
    ...contentAliases(item).map((id) => state.progress[id] || 0),
  );
}
