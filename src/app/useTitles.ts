import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Content, Source } from "../domain/content";
import { discoveryContent, isUnowned } from "../domain/discover";
import {
  episodeContent,
  seedFromContent,
  seedOf,
} from "../domain/embed-library";
import { AppError } from "../domain/errors";
import { toggleWish, type Wish } from "../domain/wishlist";
import { directoryProvider } from "../providers/directories";
import type { ArchiveProvider } from "../providers/archive";
import type { NasaProvider } from "../providers/nasa";
import type { TmdbProvider } from "../providers/tmdb";
import type { UserState } from "../persistence/user-state";
import type { ServerLibrary } from "./serverLibrary";
import type { DiscoveryState } from "./useDiscovery";
import { useAiring } from "./useAiring";
import { useShelves } from "./useShelves";
import { useWatchProviders } from "./useWatchProviders";

interface Inputs {
  visible: Content[];
  metadata: TmdbProvider | null;
  discovery: DiscoveryState;
  curated: boolean;
  kids: boolean;
  library: ServerLibrary;
  libraryTitles: Content[];
  servers: unknown;
  sources: Source[];
  selected: Content | null;
  setSelected(item: Content): void;
  user: UserState;
  setUser(update: (old: UserState) => UserState): void;
  setNotice(message: string): void;
  setDerivedItems(key: string, items: Content[], merge?: boolean): void;
}
// Everything that turns the visible catalog plus TMDB, your servers and the wishlist into
// what Home, Movies and the details view show.
export function useTitles({
  visible,
  metadata,
  discovery,
  curated,
  kids,
  library,
  libraryTitles,
  servers,
  sources,
  selected,
  setSelected,
  user,
  setUser,
  setNotice,
  setDerivedItems,
}: Inputs) {
  // What was played here, and how far, ranks "Popular on your servers". It is re-ranked
  // when the history changes, not on every progress save during playback.
  const progress = useRef(user.progress);
  progress.current = user.progress;
  const signal = useMemo(
    () => ({ history: user.history, progress: progress.current }),
    [user.history],
  );
  const { movies, live, audio, newOnServers, libraryIndex, shelves, featured } =
    useShelves(visible, metadata, discovery, curated, kids, signal);
  // Ask your servers about the titles on Home as soon as the TMDB lists arrive.
  useEffect(() => {
    if (discovery.status !== "ready") return;
    const caps = {
      trending: 24,
      popular: 20,
      series: 16,
      top: 12,
      topSeries: 12,
    };
    library.prefetch(
      Object.entries(caps).flatMap(([name, count]) =>
        (discovery.lists[name as keyof typeof caps] || [])
          .slice(0, count)
          .map(seedOf),
      ),
    );
  }, [discovery, library, servers]);
  // Opening a title you do not have yet asks every server for it, then shows it as yours.
  useEffect(() => {
    if (!selected || !isUnowned(selected)) return;
    const seed = seedFromContent(selected);
    if (!seed) return;
    library.ensure(seed);
    const found = libraryTitles.find(
      (item) => item.tmdbId === seed.tmdbId && item.type === seed.kind,
    );
    if (found) setSelected(found);
  }, [selected, library, libraryTitles, servers, setSelected]);
  // Internet Archive and NASA titles list without a file; the playable file is looked up when
  // the title is opened.
  useEffect(() => {
    if (
      !selected ||
      selected.availability !== "external" ||
      selected.streams.length
    )
      return;
    const source = sources.find(
      (s) =>
        s.id === selected.providerId &&
        (s.directory?.provider === "archive" ||
          s.directory?.provider === "nasa"),
    );
    if (!source) return;
    const controller = new AbortController();
    (directoryProvider(source) as ArchiveProvider | NasaProvider)
      .resolve(selected, controller.signal)
      .then((resolved) => {
        if (resolved.availability === "playable") setSelected(resolved);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selected, sources, setSelected]);
  const airing = useAiring(!metadata && !kids);
  const watchProviders = useWatchProviders(
    selected,
    metadata,
    selected !== null && isUnowned(selected),
  );
  const toggleWishlist = (item: Content) => {
    const seed = seedFromContent(item);
    if (!seed) return;
    setUser((old) => ({ ...old, wishlist: toggleWish(old.wishlist, seed) }));
  };
  // A wished-for title is checked against your servers each day, so it moves to
  // "On your servers" once one of them has it.
  const wishlistTitles = useMemo(
    () =>
      user.wishlist.map((w: Wish) =>
        discoveryContent(
          { ...w, overview: "", genres: [], backdrop: undefined },
          libraryIndex,
        ),
      ),
    [user.wishlist, libraryIndex],
  );
  useEffect(() => {
    const ready = wishlistTitles.filter((c) => !isUnowned(c));
    if (!ready.length) return;
    setUser((old) => ({
      ...old,
      wishlist: old.wishlist.filter(
        (w) =>
          !ready.some(
            (c) =>
              c.tmdbId === w.tmdbId &&
              (c.type === "series") === (w.kind === "series"),
          ),
      ),
    }));
    setNotice(`Now on your servers: ${ready.map((c) => c.title).join(", ")}`);
  }, [wishlistTitles, setUser, setNotice]);
  useEffect(() => {
    library.prefetch(
      user.wishlist.map((w) => ({ ...w, genres: [] as string[] })),
    );
  }, [user.wishlist, library, servers]);
  const loadLibraryEpisodes = useCallback(
    async (series: Content, signal: AbortSignal): Promise<Content[]> => {
      if (!metadata || !series.tmdbId)
        throw new AppError(
          "authorization",
          kids
            ? "Ask a grown-up to add a TMDB key from the main profile."
            : "Add a TMDB key to browse episodes.",
        );
      const hosts = library.hostsFor("series", series.tmdbId);
      const seasons = await metadata.seasons(series.tmdbId, signal);
      const episodes = seasons.flatMap((s) =>
        s.episodes.map((e) =>
          episodeContent(series, hosts, s.season, e.episode, e),
        ),
      );
      setDerivedItems("embed-episodes", episodes, true);
      return episodes;
    },
    [metadata, library, setDerivedItems, kids],
  );
  return {
    movies,
    live,
    audio,
    newOnServers,
    libraryIndex,
    shelves,
    featured,
    airing,
    watchProviders,
    wishlistTitles,
    toggleWishlist,
    loadLibraryEpisodes,
  };
}
