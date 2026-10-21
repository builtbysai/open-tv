import { useMemo } from "react";
import { isAudio, type Content } from "../domain/content";
import { isKidsGenres } from "../domain/kids";
import {
  buildLibraryIndex,
  discoveryContent,
  isArchive,
} from "../domain/discover";
import type { TmdbProvider } from "../providers/tmdb";
import type { DiscoveryState } from "./useDiscovery";
import {
  dedupeShelves,
  isOwnedTitle,
  MIN_ON_SERVERS,
  rankOnServers,
  type LocalSignal,
  type Shelf,
} from "./shelves";

const ON_SERVERS = "Popular on your servers";
const none: LocalSignal = { history: [], progress: {} };
// Everything Home and Movies derive from the visible catalog and the TMDB lists:
// the movie and live splits, the discovery shelves and the hero picks.
export function useShelves(
  visible: Content[],
  metadata: TmdbProvider | null,
  discovery: DiscoveryState,
  curated: boolean,
  kids = false,
  signal: LocalSignal = none,
) {
  const movies = useMemo(
    // Episodes stay in series details/search/library instead of flooding discovery.
    () =>
      visible
        .filter((c) => !["live", "radio", "audio", "episode"].includes(c.type))
        .sort(
          (a, b) =>
            Number(curated && isArchive(a)) - Number(curated && isArchive(b)) ||
            Number(Boolean(b.artwork)) - Number(Boolean(a.artwork)),
        ),
    [visible, curated],
  );
  const live = useMemo(
    () => visible.filter((c) => c.type === "live"),
    [visible],
  );
  const audio = useMemo(() => visible.filter(isAudio), [visible]);
  const newOnServers = useMemo(() => {
    const since = Date.now() - 45 * 24 * 3600 * 1000;
    return movies
      .filter((c) => c.addedAt && c.addedAt > since)
      .sort((a, b) => b.addedAt! - a.addedAt!)
      .slice(0, 30);
  }, [movies]);
  const libraryIndex = useMemo(
    () => (metadata ? buildLibraryIndex(movies) : new Map()),
    [metadata, movies],
  );
  // Ranked from this device's own signal, so it needs no TMDB list.
  const onServers = useMemo(
    () => rankOnServers(movies.filter(isOwnedTitle), signal).slice(0, 30),
    [movies, signal],
  );
  const shelves = useMemo((): Shelf[] => {
    const ready = discovery.status === "ready";
    const build = (name: keyof typeof discovery.lists) =>
      ready
        ? (discovery.lists[name] || [])
            .filter((d) => !kids || isKidsGenres(d.genres))
            .map((d) => discoveryContent(d, libraryIndex))
        : [];
    const ours: Shelf = { title: ON_SERVERS, items: onServers, lead: true };
    const all: Shelf[] = [
      { title: "Trending this week", items: build("trending"), lead: true },
      ours,
      { title: "Popular movies", items: build("popular") },
      { title: "Top rated", items: build("top") },
      { title: "Popular series", items: build("series") },
      { title: "Acclaimed series", items: build("topSeries") },
    ];
    const deduped = dedupeShelves(all);
    const kept = deduped.find((s) => s.title === ON_SERVERS);
    // Too few titles left after Trending: leave it out and let the others keep theirs.
    return kept && kept.items.length >= MIN_ON_SERVERS
      ? deduped
      : dedupeShelves(all.filter((s) => s !== ours));
  }, [discovery, libraryIndex, kids, onServers]);
  const featured = useMemo(() => {
    const unique = (items: Content[]) => [
      ...new Map(items.map((c) => [c.id, c] as const)).values(),
    ];
    const shelf = (title: string) =>
      shelves.find((s) => s.title === title)?.items.filter((c) => c.backdrop) ||
      [];
    const trending = unique([
      ...shelf("Trending this week").slice(0, 4),
      ...shelf("Popular series").slice(0, 2),
    ]).slice(0, 5);
    if (trending.length) return trending;
    // Still loading: show nothing rather than flashing archive titles first.
    if (curated) return [];
    return unique([
      ...movies.filter((c) => c.providerId === "open-cinema" && c.backdrop),
      ...movies.filter((c) => c.backdrop).slice(0, 1),
    ]).slice(0, 5);
  }, [shelves, curated, movies]);
  return { movies, live, audio, newOnServers, libraryIndex, shelves, featured };
}
