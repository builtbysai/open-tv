import { useEffect, useMemo, useState } from "react";
import type { Content } from "../domain/content";
import {
  discoveryContent,
  isUnowned,
  type LibraryIndex,
} from "../domain/discover";
import { similarTo } from "../domain/similar";
import type { TmdbProvider } from "../providers/tmdb";
// Titles you own come first (TMDB picks, then local genre matches); the rest follow.
export function useSimilar(
  item: Content | null,
  pool: Content[],
  index: LibraryIndex,
  provider: TmdbProvider | null,
  enabled: boolean,
): Content[] {
  const local = useMemo(
    () => (item && enabled && !isUnowned(item) ? similarTo(item, pool) : []),
    [item, pool, enabled],
  );
  const [remote, setRemote] = useState<{ id: string; items: Content[] }>({
    id: "",
    items: [],
  });
  useEffect(() => {
    if (!item || !provider || !enabled || item.type === "live") return;
    const controller = new AbortController();
    const unowned = isUnowned(item);
    provider
      .similar(
        item.title,
        item.type === "series" ? "series" : "movie",
        item.year,
        unowned ? Number(item.id.split(":")[2]) : undefined,
        controller.signal,
      )
      .then((found) =>
        setRemote({
          id: item.id,
          items: found.map((d) => discoveryContent(d, index)),
        }),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [item, provider, enabled, index]);
  return useMemo(() => {
    if (!item || !enabled) return [];
    const theirs = remote.id === item.id ? remote.items : [];
    const merged = [
      ...theirs.filter((c) => !isUnowned(c)),
      ...local,
      ...theirs.filter(isUnowned),
    ].filter((c) => c.id !== item.id);
    return [...new Map(merged.map((c) => [c.id, c])).values()].slice(0, 14);
  }, [item, enabled, local, remote]);
}
