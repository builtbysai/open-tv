import { useEffect, useState } from "react";
import type { Content } from "../domain/content";
import { seedFromContent } from "../domain/embed-library";
import type { TmdbProvider, WatchProviders } from "../providers/tmdb";
// The region comes from the browser language, for example en-GB gives GB.
export function viewerCountry(): string {
  try {
    return (
      /-([A-Za-z]{2})\b/.exec(navigator.language)?.[1].toUpperCase() || "US"
    );
  } catch {
    return "US";
  }
}
// Streaming, rental and purchase options for a title that is not on your servers.
export function useWatchProviders(
  item: Content | null,
  provider: TmdbProvider | null,
  enabled: boolean,
): WatchProviders | null {
  const [found, setFound] = useState<{
    id: string;
    data: WatchProviders;
  } | null>(null);
  const seed = item ? seedFromContent(item) : null;
  const id = item?.id;
  useEffect(() => {
    if (!seed || !provider || !enabled) return;
    const controller = new AbortController();
    provider
      .watchProviders(
        seed.kind,
        seed.tmdbId,
        viewerCountry(),
        controller.signal,
      )
      .then(
        (data) =>
          data && setFound({ id: `tmdb:${seed.kind}:${seed.tmdbId}`, data }),
      )
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, provider, enabled]);
  return found && found.id === id ? found.data : null;
}
