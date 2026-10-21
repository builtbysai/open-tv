import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Content } from "../domain/content";
import {
  discoveryContent,
  isUnowned,
  type LibraryIndex,
} from "../domain/discover";
import { seedFromContent } from "../domain/embed-library";
import { isKidsGenres } from "../domain/kids";
import { queryCatalog } from "../domain/privacy";
import type { ContentPolicy } from "../domain/content-policy";
import { buildRankedIndex, rankSearch } from "../domain/search";
import type { TmdbProvider } from "../providers/tmdb";
import {
  kindOfItem,
  searchKinds,
  type SearchKind,
} from "../screens/SearchTools";
import type { Route } from "../persistence/user-state";
import type { ServerLibrary } from "./serverLibrary";
import { useTmdbSearch } from "./useTmdbSearch";

interface Inputs {
  query: string;
  route: Route;
  visible: Content[];
  movies: Content[];
  live: Content[];
  audio: Content[];
  adult: boolean;
  kids: boolean;
  rules: ContentPolicy;
  genre: string;
  language: string;
  country: string;
  metadata: TmdbProvider | null;
  libraryIndex: LibraryIndex;
  library: ServerLibrary;
}
// Search, and the filtered lists the browse screens share: ranking runs on a lazily
// built index, and TMDB matches you do not have are checked against your servers.
export function useSearch({
  query,
  route,
  visible,
  movies,
  live,
  audio,
  adult,
  kids,
  rules,
  genre,
  language,
  country,
  metadata,
  libraryIndex,
  library,
}: Inputs) {
  const deferredQuery = useDeferredValue(query);
  // Built on first use: most sessions never search.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const idle =
      window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(() => setWarm(true), { timeout: 4000 });
    return () => cancel(handle as number);
  }, []);
  const searchReady = warm || route === "search";
  const rankedIndex = useMemo(
    () => (searchReady ? buildRankedIndex(visible) : []),
    [searchReady, visible],
  );
  const [searchKind, setSearchKind] = useState<SearchKind>("all");
  const searching = route === "search" && deferredQuery.trim() !== "";
  const ranked = useMemo(
    () => (searching ? rankSearch(rankedIndex, deferredQuery) : []),
    [searching, rankedIndex, deferredQuery],
  );
  const filtered = useMemo(
    () =>
      queryCatalog(
        route === "search"
          ? searchKind === "all"
            ? ranked
            : ranked.filter((item) => kindOfItem(item) === searchKind)
          : route === "movies"
            ? movies
            : route === "live"
              ? live
              : route === "audio"
                ? audio
                : visible,
        {
          adultUnlocked: adult,
          policy: rules,
          genre,
          language,
          country,
        },
      ),
    [
      route,
      movies,
      live,
      audio,
      visible,
      adult,
      ranked,
      searchKind,
      genre,
      language,
      country,
      rules,
    ],
  );
  const topGenres = useMemo(() => {
    if (route !== "search") return [];
    const counts = new Map<string, number>();
    for (const item of movies)
      for (const value of item.genres)
        counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([value]) => value);
  }, [route, movies]);
  const tmdbMatches = useTmdbSearch(
    metadata,
    deferredQuery,
    route === "search",
  );
  // TMDB titles none of your sources have count towards the type filters too.
  const unowned = useMemo(
    () =>
      tmdbMatches
        .filter((d) => !kids || isKidsGenres(d.genres))
        .map((d) => discoveryContent(d, libraryIndex))
        .filter(isUnowned),
    [tmdbMatches, libraryIndex, kids],
  );
  const kindCounts = useMemo(() => {
    const counts = Object.fromEntries(searchKinds.map((k) => [k, 0])) as Record<
      SearchKind,
      number
    >;
    const results = [...ranked, ...(searching ? unowned : [])];
    counts.all = results.length;
    for (const item of results) counts[kindOfItem(item)]++;
    return counts;
  }, [ranked, unowned, searching]);
  // A type with no results left (the query changed) falls back to all of them.
  useEffect(() => {
    if (searching && searchKind !== "all" && !kindCounts[searchKind])
      setSearchKind("all");
  }, [searching, searchKind, kindCounts]);
  const unownedMatches = useMemo(
    () =>
      searchKind === "all"
        ? unowned
        : unowned.filter((item) => kindOfItem(item) === searchKind),
    [unowned, searchKind],
  );
  useEffect(() => {
    library.prefetch(
      unownedMatches.flatMap((c) => {
        const seed = seedFromContent(c);
        return seed ? [seed] : [];
      }),
    );
  }, [unownedMatches, library]);
  return {
    deferredQuery,
    searching,
    kindCounts,
    filtered,
    topGenres,
    unownedMatches,
    searchKind,
    setSearchKind,
  };
}
