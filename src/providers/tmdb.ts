import type { Content } from "../domain/content";
import type { MetadataProvider } from "./contracts";
import { limitedText } from "./http";
import { timeoutSignal } from "../domain/signals";
import { clipText } from "../domain/text";
export type DiscoverList =
  "trending" | "popular" | "top" | "series" | "topSeries";
export interface Discovery {
  tmdbId: number;
  kind: "movie" | "series";
  title: string;
  year?: number;
  overview: string;
  poster?: string;
  backdrop?: string;
  rating?: number;
  genres: string[];
}
export interface WatchProviders {
  country: string;
  // TMDB's own page for the title; the listing is supplied by JustWatch.
  link?: string;
  stream: string[];
  rent: string[];
  buy: string[];
}
export interface SeasonInfo {
  season: number;
  episodes: {
    episode: number;
    name?: string;
    overview?: string;
    still?: string;
    runtime?: number;
  }[];
}
const lists: Record<DiscoverList, string> = {
  trending: "trending/movie/week",
  popular: "movie/popular",
  top: "movie/top_rated",
  series: "tv/popular",
  topSeries: "tv/top_rated",
};
const genreNames: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
};
const image = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\/[a-z0-9._-]+\.(?:jpg|png|webp)$/i.test(value);
// Keys live in this instance only. Never query TMDB for adult/unclassified items.
export class TmdbProvider implements MetadataProvider {
  constructor(private key: string) {}
  // A v4 read access token is a JWT; a v3 key is a short hex string.
  private request(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      include_adult: "false",
      language: "en-US",
      ...params,
    });
    const token = this.key.startsWith("eyJ");
    if (!token) query.set("api_key", this.key);
    return fetch(`https://api.themoviedb.org/3/${path}?${query}`, {
      signal: timeoutSignal(8000, signal),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: token ? { Authorization: `Bearer ${this.key}` } : undefined,
    });
  }
  private parse(data: unknown, kind: Discovery["kind"]): Discovery[] {
    const results = (data as { results?: unknown }).results;
    if (!Array.isArray(results)) return [];
    return results.flatMap((r: Record<string, unknown>) => {
      const title = kind === "movie" ? r.title : r.name,
        date = kind === "movie" ? r.release_date : r.first_air_date;
      if (
        r.adult === true ||
        typeof r.id !== "number" ||
        typeof title !== "string" ||
        !title
      )
        return [];
      const year = typeof date === "string" ? Number(date.slice(0, 4)) : NaN;
      return [
        {
          tmdbId: r.id,
          kind,
          title,
          year: year > 1800 ? year : undefined,
          overview:
            typeof r.overview === "string" ? clipText(r.overview, 2000) : "",
          poster: image(r.poster_path)
            ? `https://image.tmdb.org/t/p/w500${r.poster_path}`
            : undefined,
          backdrop: image(r.backdrop_path)
            ? `https://image.tmdb.org/t/p/w1280${r.backdrop_path}`
            : undefined,
          rating:
            typeof r.vote_average === "number" && r.vote_average > 0
              ? Math.round(r.vote_average * 10) / 10
              : undefined,
          genres: Array.isArray(r.genre_ids)
            ? r.genre_ids.flatMap((id: number) =>
                genreNames[id] ? [genreNames[id]] : [],
              )
            : [],
        } satisfies Discovery,
      ];
    });
  }
  private async fetchList(
    path: string,
    params: Record<string, string>,
    kind: Discovery["kind"],
    signal?: AbortSignal,
  ): Promise<Discovery[]> {
    const response = await this.request(path, params, signal);
    if (response.status === 401) throw new Error("rejected");
    if (!response.ok) throw new Error("unavailable");
    return this.parse(JSON.parse(await limitedText(response, 500000)), kind);
  }
  discover(list: DiscoverList, signal?: AbortSignal): Promise<Discovery[]> {
    return this.fetchList(
      lists[list],
      {},
      list === "series" || list === "topSeries" ? "series" : "movie",
      signal,
    );
  }
  async search(query: string, signal?: AbortSignal): Promise<Discovery[]> {
    const [movies, series] = await Promise.all([
      this.fetchList("search/movie", { query }, "movie", signal),
      this.fetchList("search/tv", { query }, "series", signal),
    ]);
    return [...movies.slice(0, 8), ...series.slice(0, 4)];
  }
  // Recommendations for a title, resolved from its name unless the TMDB id is known.
  async similar(
    title: string,
    kind: Discovery["kind"],
    year?: number,
    tmdbId?: number,
    signal?: AbortSignal,
  ): Promise<Discovery[]> {
    const type = kind === "movie" ? "movie" : "tv";
    let id = tmdbId;
    if (!id) {
      const found = (
        await this.fetchList(`search/${type}`, { query: title }, kind, signal)
      ).find(
        (d) =>
          d.title.toLowerCase() === title.toLowerCase() &&
          (!year || !d.year || Math.abs(d.year - year) <= 1),
      );
      if (!found) return [];
      id = found.tmdbId;
    }
    return this.fetchList(`${type}/${id}/recommendations`, {}, kind, signal);
  }
  // Where a title can be watched legally in a region (data supplied by JustWatch).
  async watchProviders(
    kind: Discovery["kind"],
    tmdbId: number,
    country: string,
    signal?: AbortSignal,
  ): Promise<WatchProviders | null> {
    const response = await this.request(
      `${kind === "movie" ? "movie" : "tv"}/${tmdbId}/watch/providers`,
      {},
      signal,
    );
    if (!response.ok) return null;
    const region = JSON.parse(await limitedText(response, 500000)).results?.[
      country
    ];
    if (!region || typeof region !== "object") return null;
    const names = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .map((p: { provider_name?: unknown }) => p?.provider_name)
            .filter((n): n is string => typeof n === "string" && n !== "")
            .map((n) => n.slice(0, 60))
            .slice(0, 12)
        : [];
    const link =
      typeof region.link === "string" &&
      region.link.startsWith("https://www.themoviedb.org/")
        ? region.link
        : undefined;
    const found = {
      country,
      link,
      stream: names(region.flatrate),
      rent: names(region.rent),
      buy: names(region.buy),
    };
    return found.stream.length || found.rent.length || found.buy.length
      ? found
      : null;
  }
  // Seasons and episodes for a show, for servers that are addressed by TMDB id.
  async seasons(tmdbId: number, signal?: AbortSignal): Promise<SeasonInfo[]> {
    const show = await this.request(`tv/${tmdbId}`, {}, signal);
    if (!show.ok) throw new Error("unavailable");
    const listed = JSON.parse(await limitedText(show, 500000)).seasons;
    const numbers: number[] = (Array.isArray(listed) ? listed : [])
      .map((s: { season_number?: unknown }) => s.season_number)
      .filter(
        (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0,
      )
      .slice(0, 40);
    const seasons = await Promise.all(
      numbers.map(async (number): Promise<SeasonInfo | null> => {
        const response = await this.request(
          `tv/${tmdbId}/season/${number}`,
          {},
          signal,
        );
        if (!response.ok) return null;
        const data = JSON.parse(await limitedText(response, 500000));
        const episodes = Array.isArray(data.episodes) ? data.episodes : [];
        return {
          season: number,
          episodes: episodes.flatMap((e: Record<string, unknown>) =>
            Number.isInteger(e.episode_number) &&
            (e.episode_number as number) > 0
              ? [
                  {
                    episode: e.episode_number as number,
                    name:
                      typeof e.name === "string"
                        ? e.name.slice(0, 200)
                        : undefined,
                    overview:
                      typeof e.overview === "string"
                        ? clipText(e.overview, 2000)
                        : undefined,
                    still: image(e.still_path)
                      ? `https://image.tmdb.org/t/p/w300${e.still_path}`
                      : undefined,
                    runtime:
                      typeof e.runtime === "number" && e.runtime > 0
                        ? e.runtime
                        : undefined,
                  },
                ]
              : [],
          ),
        };
      }),
    );
    return seasons.filter((s): s is SeasonInfo => s !== null);
  }
  async lookup(
    title: string,
    type: Content["type"],
    signal?: AbortSignal,
  ): Promise<Partial<Content> | null> {
    const response = await this.request(
      `search/${type === "series" || type === "episode" || type === "anime" ? "tv" : "movie"}`,
      { query: title },
      signal,
    );
    if (!response.ok) return null;
    const data = JSON.parse(await limitedText(response, 500000));
    const match =
      Array.isArray(data.results) &&
      data.results.find(
        (r: { adult?: boolean; title?: string; name?: string }) =>
          r &&
          r.adult === false &&
          typeof (r.title || r.name) === "string" &&
          (r.title || r.name || "").toLowerCase() === title.toLowerCase(),
      );
    if (!match) return null;
    return {
      description:
        typeof match.overview === "string"
          ? clipText(match.overview, 10000)
          : undefined,
      artwork: image(match.poster_path)
        ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
        : undefined,
      backdrop: image(match.backdrop_path)
        ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
        : undefined,
    };
  }
}
