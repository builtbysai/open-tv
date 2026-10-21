import type { Content } from "./content";
import type { Discovery } from "../providers/tmdb";
const noise =
  /\b(?:480p|720p|1080p|2160p|4k|uhd|hdr|bluray|brrip|bdrip|webrip|web-?dl|hdtv|dvdrip|x26[45]|hevc|aac|multi|dual)\b/g;
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(noise, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(?:the|a|an) /, "");
}
function yearOf(item: Content): number | undefined {
  if (item.year) return item.year;
  const found = /[([](\d{4})[)\]]|\b((?:19|20)\d{2})\b/.exec(item.title);
  return found ? Number(found[1] || found[2]) : undefined;
}
export type LibraryIndex = Map<string, Content[]>;
export function buildLibraryIndex(items: Content[]): LibraryIndex {
  const index: LibraryIndex = new Map();
  for (const item of items) {
    // A series record has no stream until its episodes load, so it counts as owned
    // when the source named its TMDB id.
    const resolvable =
      item.availability === "playable" ||
      (item.type === "series" && item.tmdbId !== undefined);
    if (
      !resolvable ||
      !["movie", "series", "documentary", "anime"].includes(item.type)
    )
      continue;
    const key = titleKey(item.title);
    if (key) index.set(key, [...(index.get(key) || []), item]);
    if (item.tmdbId) {
      const exact = idKey(
        item.type === "series" ? "series" : "movie",
        item.tmdbId,
      );
      index.set(exact, [...(index.get(exact) || []), item]);
    }
  }
  return index;
}
// The leading # cannot appear in a title key, so ids and titles share one map.
const idKey = (kind: Discovery["kind"], id: number) => `#tmdb:${kind}:${id}`;
// Titles carrying the same TMDB id match exactly; the rest fall back to title and year,
// unless the source says the title is a different TMDB entry.
export function matchAll(discovery: Discovery, index: LibraryIndex): Content[] {
  const exact = index.get(idKey(discovery.kind, discovery.tmdbId)) || [];
  const byTitle = (index.get(titleKey(discovery.title)) || []).filter(
    (item) => {
      if (exact.includes(item)) return false;
      if ((discovery.kind === "series") !== (item.type === "series"))
        return false;
      if (item.tmdbId && item.tmdbId !== discovery.tmdbId) return false;
      const year = yearOf(item);
      return !year || !discovery.year || Math.abs(year - discovery.year) <= 1;
    },
  );
  return [...exact, ...byTitle];
}
export const matchDiscovery = (discovery: Discovery, index: LibraryIndex) =>
  matchAll(discovery, index)[0];
export function discoveryContent(
  discovery: Discovery,
  index: LibraryIndex,
): Content {
  const matches = matchAll(discovery, index);
  const owned = matches[0];
  if (owned)
    return {
      ...owned,
      // Every server that has the title becomes a fallback stream.
      streams: [
        ...new Map(
          matches.flatMap((m) => m.streams).map((s) => [s.url, s] as const),
        ).values(),
      ],
      aliases: [
        ...new Set(
          matches.slice(1).flatMap((m) => [m.id, ...(m.aliases || [])]),
        ),
        ...(owned.aliases || []),
      ],
      poster: discovery.poster,
      rating: discovery.rating,
      backdrop: owned.backdrop || discovery.backdrop,
      description: owned.description || discovery.overview || undefined,
      year: owned.year || discovery.year,
      genres: owned.genres.length ? owned.genres : discovery.genres,
    };
  return {
    id: `tmdb:${discovery.kind}:${discovery.tmdbId}`,
    providerId: "tmdb",
    tmdbId: discovery.tmdbId,
    title: discovery.title,
    type: discovery.kind === "series" ? "series" : "movie",
    description: discovery.overview || undefined,
    artwork: discovery.poster,
    poster: discovery.poster,
    backdrop: discovery.backdrop,
    rating: discovery.rating,
    year: discovery.year,
    genres: discovery.genres,
    languages: [],
    countries: [],
    classification: "general",
    availability: "unavailable",
    streams: [],
    rights: { status: "unverified" },
  };
}
// Listings from TMDB or TVmaze that no server of yours has.
export const isUnowned = (item: Content) =>
  item.providerId === "tmdb" || item.providerId === "tvmaze";
// The free, openly licensed collections that fill Home until TMDB takes over.
const archiveProviders = new Set(["open-cinema", "classic-films"]);
export const isArchive = (item: Content) =>
  archiveProviders.has(item.providerId);
