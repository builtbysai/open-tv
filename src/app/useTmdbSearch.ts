import { useEffect, useState } from "react";
import type { Discovery, TmdbProvider } from "../providers/tmdb";
export function useTmdbSearch(
  provider: TmdbProvider | null,
  query: string,
  enabled: boolean,
): Discovery[] {
  const [results, setResults] = useState<{ query: string; items: Discovery[] }>(
    { query: "", items: [] },
  );
  const text = query.trim();
  useEffect(() => {
    if (!provider || !enabled || text.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      provider
        .search(text, controller.signal)
        .then((items) => setResults({ query: text, items }))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [provider, text, enabled]);
  return provider && enabled && text.length >= 2 && results.query === text
    ? results.items
    : [];
}
