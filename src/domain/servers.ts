import type { Classification, Content, Stream } from "./content";
import { mediaUrl, persistableUrl } from "./urls";
import { AppError } from "./errors";
export interface MediaServer {
  id: string;
  name: string;
  base: string;
  classification: Classification;
  enabled: boolean;
  // Servers are trusted by default. An untrusted one can be sandboxed, or get a click
  // guard that absorbs the first click so it cannot trigger a pop-up.
  guard?: "open" | "click" | "sandbox";
  // How the server addresses a title, when it isn't the usual /embed/movie/{id} and
  // /embed/tv/{id}/{season}/{episode}. Always on the server's own address ({base}).
  movie?: string;
  episode?: string;
}
export const guards = ["open", "click", "sandbox"] as const;
// Every server uses these addresses unless it states its own format.
export const DEFAULT_MOVIE = "{base}/embed/movie/{id}";
export const DEFAULT_EPISODE = "{base}/embed/tv/{id}/{season}/{episode}";
// Common layouts, so most servers need no typing beyond their address.
export const addressFormats = [
  {
    id: "embed",
    label: "/embed/movie/… (most common)",
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
const TEMPLATE = /^\{base\}[A-Za-z0-9\-._~/?=&%{}]*$/;
// A template stays on the server's own address and uses only the known placeholders.
export function validTemplate(
  value: unknown,
  needsEpisode: boolean,
): string | null {
  if (typeof value !== "string" || value.length > 300 || !TEMPLATE.test(value))
    return null;
  const names = [...value.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]);
  if (names.some((n) => !["base", "id", "season", "episode"].includes(n)))
    return null;
  if (!names.includes("id")) return null;
  if (needsEpisode && (!names.includes("season") || !names.includes("episode")))
    return null;
  return value;
}
export function serverAddress(value: string): string | null {
  const url = mediaUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  return parsed.search || parsed.hash ? null : url.replace(/\/+$/, "");
}
export function validateServer(value: unknown): MediaServer | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  const base = typeof s.base === "string" ? serverAddress(s.base) : null;
  if (
    typeof s.id !== "string" ||
    !/^ot-[a-z0-9]{1,60}$/.test(s.id) ||
    typeof s.name !== "string" ||
    !s.name.trim() ||
    !base ||
    !["general", "adult", "unknown"].includes(String(s.classification))
  )
    return null;
  return {
    id: s.id,
    name: s.name.trim().slice(0, 100),
    base,
    classification: s.classification as Classification,
    enabled: s.enabled === true,
    ...(s.guard === "click" || s.guard === "sandbox" ? { guard: s.guard } : {}),
    ...(validTemplate(s.movie, false) ? { movie: s.movie as string } : {}),
    ...(validTemplate(s.episode, true) ? { episode: s.episode as string } : {}),
  };
}
// A list of servers from a file someone shares: { servers: [{ name, base, guard?,
// movie?, episode? }] } or the bare list. Each gets a fresh id and starts switched off.
export function importServers(value: unknown): MediaServer[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { servers?: unknown })?.servers)
      ? (value as { servers: unknown[] }).servers
      : [];
  return list
    .slice(0, 100)
    .map((entry) => {
      const raw = (entry ?? {}) as Record<string, unknown>;
      return validateServer({
        ...raw,
        id: `ot-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`,
        classification: raw.classification === "adult" ? "adult" : "general",
        enabled: false,
      });
    })
    .filter((s): s is MediaServer => !!s);
}
export function canPersistServer(server: MediaServer): boolean {
  return persistableUrl(server.base);
}
export function serverMediaUrl(
  server: MediaServer,
  item: Pick<Content, "type" | "providerItemId" | "season" | "episode">,
): string {
  const base = serverAddress(server.base);
  if (!base || !/^[a-z0-9_-]{1,100}$/i.test(item.providerItemId || ""))
    throw new AppError(
      "format",
      "Use a valid server and a title ID containing letters, numbers, hyphens or underscores.",
    );
  const isEpisode = item.type === "episode" || item.type === "anime";
  if (!isEpisode && !["movie", "documentary"].includes(item.type))
    throw new AppError(
      "format",
      "This server supports movies, documentaries and episodes.",
    );
  if (
    isEpisode &&
    (!Number.isInteger(item.season) ||
      item.season! < 0 ||
      item.season! > 10000 ||
      !Number.isInteger(item.episode) ||
      item.episode! < 1 ||
      item.episode! > 10000)
  )
    throw new AppError(
      "format",
      "Enter a valid season and episode number. Season zero is Specials.",
    );
  const template =
    (isEpisode ? server.episode : server.movie) ||
    (isEpisode ? DEFAULT_EPISODE : DEFAULT_MOVIE);
  const url = template
    .replace("{base}", base)
    .replace(/\{id\}/g, encodeURIComponent(item.providerItemId!))
    .replace(/\{season\}/g, String(item.season ?? ""))
    .replace(/\{episode\}/g, String(item.episode ?? ""));
  const safe = mediaUrl(url);
  if (!safe || new URL(safe).origin !== new URL(base).origin)
    throw new AppError("format", "This server's address format doesn't work.");
  return safe;
}
// A title addressed by a TMDB number can be tried on every other connected general server
// too, so the linked server is the first choice, not the only one.
function alternatives(
  item: Content,
  linked: MediaServer,
  servers: MediaServer[],
): Stream[] {
  if (!/^\d{1,9}$/.test(item.providerItemId || "")) return [];
  if (linked.classification !== "general") return [];
  const out: Stream[] = [];
  for (const other of servers) {
    if (other.id === linked.id || !other.enabled) continue;
    if (other.classification !== "general") continue;
    try {
      out.push({
        url: serverMediaUrl(other, item),
        format: "embed",
        quality: other.name,
        guard: other.guard,
      });
    } catch {
      /* A server whose address cannot be used is skipped. */
    }
  }
  return out;
}
export function resolveServerMedia(
  item: Content,
  servers: MediaServer[],
): Content {
  if (!item.serverId) return item;
  const server = servers.find((s) => s.id === item.serverId);
  const classification =
    server && server.classification !== "general"
      ? server.classification === "adult" || item.classification === "adult"
        ? "adult"
        : "unknown"
      : item.classification;
  if (!server || !server.enabled)
    return {
      ...item,
      classification,
      availability: "unavailable",
      streams: [],
    };
  try {
    return {
      ...item,
      classification,
      // A server addressed by TMDB id lets the title match TMDB lists exactly.
      tmdbId:
        item.tmdbId ??
        (/^\d{1,9}$/.test(item.providerItemId || "") &&
        item.type !== "episode" &&
        item.type !== "anime"
          ? Number(item.providerItemId)
          : undefined),
      availability: "playable",
      streams: [
        {
          url: serverMediaUrl(server, item),
          format: "embed",
          quality: server.name,
          guard: server.guard,
        },
        ...alternatives(item, server, servers),
      ],
    };
  } catch {
    return {
      ...item,
      classification,
      availability: "unavailable",
      streams: [],
    };
  }
}
// Whether anything answers at the server's address. A request that cannot be read
// (no CORS) still resolves when the server is there, and fails when it is not.
export async function serverReachable(
  server: Pick<MediaServer, "base">,
  signal?: AbortSignal,
  timeoutMs = 6000,
): Promise<boolean> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(server.base, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    void response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}
