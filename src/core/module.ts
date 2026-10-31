// The extension point. The app shell (TV UI, phone UI, player, remote protocol, sync) knows
// nothing about movies: it knows modules. A module contributes content (rails, search,
// details) and says how to play it. TMDB + your servers is the first module
// (src/modules/movies); live TV, radio, music or anything else is another file that calls
// `registry.register(...)`. Nothing in the relay or the remote protocol has to change,
// because they carry an opaque MediaRef, never module-specific fields.

// A reference to one playable or browsable thing. Small, plain JSON: it crosses the relay,
// is stored in My List and history, and is rebuilt into sources by its module.
export interface MediaRef {
  mod: string; // owning module id, e.g. "movies"
  kind: string; // module-defined, e.g. "movie" | "tv" | "episode"
  id: string; // module-defined id (a TMDB id for the movies module)
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  season?: number; // episodes only
  episode?: number;
  epTitle?: string;
}

export interface Rail {
  id: string;
  title: string;
  items: MediaRef[];
}

export interface Season {
  number: number;
  name: string;
  episodes: MediaRef[];
}

export interface Details {
  ref: MediaRef;
  facts: string[]; // "2024", "2h 14m", "8.1" ...
  genres: string[];
  cast: string[];
  tagline?: string;
  seasons?: { number: number; name: string; count: number }[];
  related: MediaRef[];
}

// How a source is played. `embed` (a page in a frame) is the only renderer today. A module
// that yields `stream` (a direct HLS/MP4 URL) needs a renderer registered for it in
// src/player/renderers.ts; the session, remote and HUD already treat both the same way.
export type PlaySource =
  | {
      type: "embed";
      id: string; // stable per server, so "next server" and resume can refer to it
      label: string;
      url: string;
      sandbox: boolean;
      // Whether this server is known to speak the bridge (from the compatibility check).
      bridge: "yes" | "no" | "unknown";
    }
  | {
      type: "stream";
      id: string;
      label: string;
      url: string;
      format: "hls" | "mp4";
    };

export interface ModuleContext {
  signal?: AbortSignal;
}

export interface AppModule {
  id: string;
  label: string;
  // Extra top-level destinations in the TV navigation (the movies module adds "Movies" and
  // "TV Shows"). "home" is always present and asks every module for its rails.
  sections: { id: string; label: string }[];
  // False until the module is configured (the movies module needs a TMDB key and a server).
  // The shell shows the setup screen instead of empty rails.
  ready(): boolean;
  rails(section: string, ctx: ModuleContext): Promise<Rail[]>;
  search?(query: string, ctx: ModuleContext): Promise<MediaRef[]>;
  details?(ref: MediaRef, ctx: ModuleContext): Promise<Details>;
  episodes?(ref: MediaRef, season: number, ctx: ModuleContext): Promise<Season>;
  // Ordered candidates to try. Pure: no network.
  sources(ref: MediaRef, opts: { start: number }): PlaySource[];
  // What plays after this one (the next episode), or null.
  next?(ref: MediaRef, ctx: ModuleContext): Promise<MediaRef | null>;
}

const modules = new Map<string, AppModule>();
export const registry = {
  register(module: AppModule) {
    modules.set(module.id, module);
  },
  get(id: string): AppModule | undefined {
    return modules.get(id);
  },
  all(): AppModule[] {
    return [...modules.values()];
  },
};

const text = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max)
    : "";
const url = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 600) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const int = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : undefined;

// The one validator for refs that come from outside: the relay, storage, a backup.
export function parseRef(value: unknown): MediaRef | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  const mod = text(raw.mod, 40),
    kind = text(raw.kind, 40),
    id = text(raw.id, 100),
    title = text(raw.title, 200);
  if (!/^[a-z0-9-]+$/.test(mod) || !/^[a-z0-9-]+$/.test(kind) || !id || !title)
    return null;
  const rating =
    typeof raw.rating === "number" && raw.rating >= 0 && raw.rating <= 10
      ? Math.round(raw.rating * 10) / 10
      : undefined;
  const ref: MediaRef = { mod, kind, id, title };
  const set = <K extends keyof MediaRef>(key: K, v: MediaRef[K] | undefined) => {
    if (v !== undefined && v !== "") ref[key] = v;
  };
  set("year", int(raw.year, 1800, 2200));
  set("poster", url(raw.poster));
  set("backdrop", url(raw.backdrop));
  set("overview", text(raw.overview, 1200));
  set("rating", rating);
  set("season", int(raw.season, 0, 10000));
  set("episode", int(raw.episode, 0, 10000));
  set("epTitle", text(raw.epTitle, 200));
  return ref;
}

// A stable key for My List and progress: one entry per title, not per episode.
export const refKey = (ref: Pick<MediaRef, "mod" | "kind" | "id">): string => {
  const kind = ref.kind === "episode" ? "tv" : ref.kind;
  return `${ref.mod}:${kind}:${ref.id}`;
};
