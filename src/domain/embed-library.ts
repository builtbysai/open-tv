import type { Content } from "./content";
import { serverMediaUrl, type MediaServer } from "./servers";
import { timeoutSignal } from "./signals";
export type Kind = "movie" | "series";
// "unknown" covers servers that do not answer at all (timeouts, 5xx, offline).
export type Presence = "available" | "missing" | "unknown";
export const EMBED_SOURCE_ID = "embed-library";
export interface Seed {
  kind: Kind;
  tmdbId: number;
  title: string;
  year?: number;
  overview?: string;
  poster?: string;
  backdrop?: string;
  rating?: number;
  genres: string[];
}
export const titleId = (kind: Kind, tmdbId: number) =>
  `embed:${kind}:${tmdbId}`;
// A movie lives at {base}/embed/movie/{tmdb id}; a show at {base}/embed/tv/{id}/{season}/{episode}.
// The first episode stands in for the show.
export function embedUrl(
  server: MediaServer,
  kind: Kind,
  tmdbId: number,
  season = 1,
  episode = 1,
): string {
  return serverMediaUrl(server, {
    type: kind === "movie" ? "movie" : "episode",
    providerItemId: String(tmdbId),
    season,
    episode,
  });
}
// A server that sends CORS headers answers for the title itself: a successful response
// means it has it, a 404 or 410 means it does not. Most servers send none, and then the
// answer cannot be read: a request that still goes through means the server is up, and
// the title is assumed to be there. The player confirms it when it opens (see
// Player's embed check) and a server that fails is filtered out afterwards.
export async function probeUrl(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 7000,
): Promise<Presence> {
  const timeout = timeoutSignal(timeoutMs);
  const combined = signal ? timeoutSignal(timeoutMs, signal) : timeout;
  const request = (mode: RequestMode) =>
    fetch(url, {
      mode,
      signal: combined,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  try {
    const response = await request("cors");
    void response.body?.cancel();
    if (response.ok) return "available";
    return response.status === 404 || response.status === 410
      ? "missing"
      : "unknown";
  } catch {
    if (signal?.aborted || timeout.aborted) return "unknown";
    try {
      void (await request("no-cors")).body?.cancel();
      return "available";
    } catch {
      return "unknown";
    }
  }
}
export const probeServer = (
  server: MediaServer,
  kind: Kind,
  tmdbId: number,
  signal?: AbortSignal,
  timeoutMs = 7000,
) => probeUrl(embedUrl(server, kind, tmdbId), signal, timeoutMs);
// The catalog entry for a title found on your servers. A movie plays straight from
// every server that has it; a show opens to its episodes.
export function libraryContent(seed: Seed, servers: MediaServer[]): Content {
  return {
    id: titleId(seed.kind, seed.tmdbId),
    providerId: EMBED_SOURCE_ID,
    providerItemId: String(seed.tmdbId),
    tmdbId: seed.tmdbId,
    title: seed.title,
    type: seed.kind,
    description: seed.overview || undefined,
    artwork: seed.poster,
    poster: seed.poster,
    backdrop: seed.backdrop,
    rating: seed.rating,
    year: seed.year,
    genres: seed.genres,
    languages: [],
    countries: [],
    classification: "general",
    availability: seed.kind === "movie" ? "playable" : "unavailable",
    streams:
      seed.kind === "movie"
        ? servers.map((server) => ({
            url: embedUrl(server, "movie", seed.tmdbId),
            format: "embed" as const,
            quality: server.name,
            guard: server.guard,
          }))
        : [],
    rights: { status: "user-authorized" },
  };
}
export function episodeContent(
  series: Content,
  servers: MediaServer[],
  season: number,
  episode: number,
  details: {
    name?: string;
    overview?: string;
    still?: string;
    runtime?: number;
  },
): Content {
  const tmdbId = series.tmdbId!;
  return {
    id: `${series.id}:s${season}e${episode}`,
    providerId: EMBED_SOURCE_ID,
    providerItemId: String(tmdbId),
    tmdbId,
    seriesId: series.id,
    season,
    episode,
    title: details.name || `Episode ${episode}`,
    type: "episode",
    description: details.overview || undefined,
    artwork: details.still || series.artwork,
    poster: series.poster,
    backdrop: series.backdrop,
    duration: details.runtime ? details.runtime * 60 : undefined,
    genres: series.genres,
    languages: [],
    countries: [],
    classification: "general",
    availability: servers.length ? "playable" : "unavailable",
    streams: servers.map((server) => ({
      url: embedUrl(server, "series", tmdbId, season, episode),
      format: "embed" as const,
      quality: server.name,
      guard: server.guard,
    })),
    rights: { status: "user-authorized" },
  };
}
export const seedOf = (d: Seed): Seed => ({
  kind: d.kind,
  tmdbId: d.tmdbId,
  title: d.title,
  year: d.year,
  overview: d.overview,
  poster: d.poster,
  backdrop: d.backdrop,
  rating: d.rating,
  genres: d.genres,
});
// A TMDB listing that is not in the catalog yet carries its id as tmdb:{kind}:{id}.
export function seedFromContent(item: Content): Seed | null {
  const match = /^tmdb:(movie|series):(\d+)$/.exec(item.id);
  if (!match) return null;
  return {
    kind: match[1] as Kind,
    tmdbId: Number(match[2]),
    title: item.title,
    year: item.year,
    overview: item.description,
    poster: item.poster,
    backdrop: item.backdrop,
    rating: item.rating,
    genres: item.genres,
  };
}
