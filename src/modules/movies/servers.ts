import {
  DEFAULT_EPISODE,
  DEFAULT_MOVIE,
  fillPattern,
  validPattern,
} from "./pattern";

// One of your own servers. Open TV ships with none: adding one is an explicit act of trust,
// and only servers you are entitled to use belong here.
export interface Server {
  id: string;
  name: string;
  base: string; // origin plus optional path prefix, no trailing slash
  movie?: string; // custom pattern; default {base}/embed/movie/{id}
  episode?: string; // custom pattern; default {base}/embed/tv/{id}/{season}/{episode}
  // Run the frame in a sandbox: no pop-ups, no navigating the TV app away. Some players
  // detect a sandbox and refuse to play, so it is off by default and per server.
  sandbox: boolean;
  enabled: boolean;
  order: number;
  // What the compatibility check found: "yes" = speaks the bridge, so silence means failure.
  bridge: "yes" | "no" | "unknown";
}

const isLocalHost = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

// Normalizes what a person typed into a server base, or says why it cannot be used.
// `app` is the page the frame will sit in: an https page cannot show an http frame (mixed
// content), and a frame on the app's own origin would not be a separate server at all.
export function normalizeBase(
  input: string,
  app: { origin: string; protocol: string } = {
    origin: location.origin,
    protocol: location.protocol,
  },
): { base: string } | { error: string } {
  let text = input.trim();
  if (!text) return { error: "Enter the server's address." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: "That is not a valid address." };
  }
  if (url.username || url.password)
    return { error: "Leave passwords and logins out of the address." };
  if (url.search || url.hash)
    return { error: "Put query parameters in the pattern, not the address." };
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { error: "Use an http(s) address." };
  if (
    url.protocol === "http:" &&
    app.protocol === "https:" &&
    !isLocalHost(url.hostname)
  )
    return {
      error:
        "This app is served over https, so the browser blocks an http server in its frame. Use https.",
    };
  if (url.origin === app.origin)
    return { error: "A server cannot be on the same address as the app." };
  return { base: (url.origin + url.pathname).replace(/\/+$/, "") };
}

export function validateServer(
  value: unknown,
  app?: { origin: string; protocol: string },
): Server | null {
  const s = value as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  if (typeof s.id !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(s.id)) return null;
  const name = typeof s.name === "string" ? s.name.trim().slice(0, 60) : "";
  const base = typeof s.base === "string" ? normalizeBase(s.base, app) : null;
  if (!name || !base || "error" in base) return null;
  const movie = s.movie === undefined ? undefined : validPattern(s.movie, "movie");
  const episode =
    s.episode === undefined ? undefined : validPattern(s.episode, "episode");
  // A pattern that is present but invalid rejects the whole record: silently falling back
  // to the default would send titles to a different address than the owner wrote.
  if ((s.movie !== undefined && !movie) || (s.episode !== undefined && !episode))
    return null;
  return {
    id: s.id,
    name,
    base: base.base,
    ...(movie ? { movie } : {}),
    ...(episode ? { episode } : {}),
    sandbox: s.sandbox === true,
    enabled: s.enabled !== false,
    order:
      typeof s.order === "number" && Number.isFinite(s.order) ? s.order : 0,
    bridge: s.bridge === "yes" || s.bridge === "no" ? s.bridge : "unknown",
  };
}

// A list from a shared file: { servers: [...] } or the bare list. Imported servers start
// disabled and get fresh ids, so importing never starts contacting anything by itself.
export function importServers(
  value: unknown,
  newId: () => string,
  app?: { origin: string; protocol: string },
): Server[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { servers?: unknown } | null)?.servers)
      ? (value as { servers: unknown[] }).servers
      : [];
  return list
    .slice(0, 50)
    .map((entry, index) =>
      validateServer(
        { ...(entry as object), id: newId(), enabled: false, order: index, bridge: "unknown" },
        app,
      ),
    )
    .filter((s): s is Server => !!s);
}

export type EmbedTarget =
  | { kind: "movie"; id: string; start?: number }
  | { kind: "episode"; id: string; season: number; episode: number; start?: number };

// The address of a title on a server, or null when it cannot be formed.
export function embedUrl(server: Pick<Server, "base" | "movie" | "episode">, target: EmbedTarget): string | null {
  if (target.kind === "movie")
    return fillPattern(server.movie || DEFAULT_MOVIE, server.base, {
      id: target.id,
      start: target.start,
    });
  return fillPattern(server.episode || DEFAULT_EPISODE, server.base, {
    id: target.id,
    season: target.season,
    episode: target.episode,
    start: target.start,
  });
}

// The two addresses a person sees in the form before saving, for TMDB's own sample
// titles (a film and the first episode of a show), so a wrong pattern shows at once.
export const SAMPLE = { movie: "603", tv: "1396" };
export function previewUrls(server: Pick<Server, "base" | "movie" | "episode">) {
  return {
    movie: embedUrl(server, { kind: "movie", id: SAMPLE.movie }),
    episode: embedUrl(server, { kind: "episode", id: SAMPLE.tv, season: 1, episode: 1 }),
  };
}

export const byOrder = (a: Server, b: Server) => a.order - b.order || a.name.localeCompare(b.name);
