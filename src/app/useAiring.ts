import { useEffect, useState } from "react";
import type { Content } from "../domain/content";
import { TvMazeProvider } from "../providers/tvmaze";
// Without a TMDB key, Home still has something current: shows airing today, from TVmaze
// (no key, no account). They are listings, not playable titles.
export function useAiring(enabled: boolean): Content[] {
  const [items, setItems] = useState<Content[]>([]);
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    new TvMazeProvider()
      .trending(controller.signal)
      .then((shows) =>
        setItems(
          shows.slice(0, 20).map((show): Content => ({
            id: `tvmaze:${show.tvmazeId}`,
            providerId: "tvmaze",
            title: show.title,
            type: "series",
            description: show.overview || undefined,
            artwork: show.poster,
            poster: show.poster,
            backdrop: show.backdrop,
            rating: show.rating,
            year: show.year,
            genres: show.genres,
            languages: [],
            countries: [],
            classification: "general",
            availability: "unavailable",
            streams: [],
            rights: { status: "unverified" },
          })),
        ),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [enabled]);
  return items;
}
