// The server pattern: how one of your servers addresses a title.
//
//   movie    {base}/embed/movie/{id}
//   episode  {base}/embed/tv/{id}/{season}/{episode}
//
// {base} is the server's own address. A pattern must start with {base} and may use only the
// placeholders below, and the finished address must still be on the server's origin, so a
// title (or a hostile pattern in an imported file) can never be sent to another site.

export const DEFAULT_MOVIE = "{base}/embed/movie/{id}";
export const DEFAULT_EPISODE = "{base}/embed/tv/{id}/{season}/{episode}";

export const PRESETS = [
  {
    id: "embed",
    label: "/embed/movie/… (default)",
    movie: DEFAULT_MOVIE,
    episode: DEFAULT_EPISODE,
  },
  {
    id: "short",
    label: "/movie/… and /tv/…",
    movie: "{base}/movie/{id}",
    episode: "{base}/tv/{id}/{season}/{episode}",
  },
  {
    id: "query",
    label: "?tmdb=… query",
    movie: "{base}/embed?tmdb={id}",
    episode: "{base}/embed?tmdb={id}&season={season}&episode={episode}",
  },
  {
    id: "dash",
    label: "/tv/{id}-{season}-{episode}",
    movie: "{base}/movie/{id}",
    episode: "{base}/tv/{id}-{season}-{episode}",
  },
] as const;

const PLACEHOLDERS = ["base", "id", "season", "episode", "start"];
// No ":" or "@" so a pattern cannot smuggle in a port or credentials; the origin check below
// is the real guard, this keeps patterns plain.
const SHAPE = /^\{base\}(?:[/?][A-Za-z0-9\-._~/?=&%{}]*)?$/;

export function validPattern(value: unknown, kind: "movie" | "episode"): string | null {
  if (typeof value !== "string" || value.length > 300 || !SHAPE.test(value))
    return null;
  const names = (value.match(/\{[a-z]+\}/g) || []).map((m) => m.slice(1, -1));
  if (names.some((n) => !PLACEHOLDERS.includes(n))) return null;
  if (!names.includes("id")) return null;
  if (kind === "episode" && !(names.includes("season") && names.includes("episode")))
    return null;
  // {base} exactly once, at the start.
  if (names.filter((n) => n === "base").length !== 1) return null;
  return value;
}

export interface PatternVars {
  id: string;
  season?: number;
  episode?: number;
  start?: number;
}

// The server's address with the pattern filled in, or null when anything is off.
export function fillPattern(pattern: string, base: string, vars: PatternVars): string | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(vars.id)) return null;
  const num = (n: number | undefined) =>
    Number.isInteger(n) && n! >= 0 && n! <= 100000 ? String(n) : null;
  // A placeholder the pattern uses must have a real value: never leave `/1396//` behind.
  const season = num(vars.season);
  const episode = num(vars.episode);
  const start = num(vars.start ?? 0);
  if (pattern.includes("{season}") && season === null) return null;
  if (pattern.includes("{episode}") && episode === null) return null;
  if (pattern.includes("{start}") && start === null) return null;
  const filled = pattern
    .replace(/\{base\}/g, base)
    .replace(/\{id\}/g, encodeURIComponent(vars.id))
    .replace(/\{season\}/g, season ?? "")
    .replace(/\{episode\}/g, episode ?? "")
    .replace(/\{start\}/g, start ?? "");
  try {
    const url = new URL(filled);
    const home = new URL(base);
    if (
      url.origin !== home.origin ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" && url.protocol !== "http:")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
