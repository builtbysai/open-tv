import { afterEach, describe, expect, it, vi } from "vitest";
import { item } from "./fixtures";
import {
  buildLibraryIndex,
  discoveryContent,
  matchDiscovery,
  titleKey,
} from "../src/domain/discover";
import { TmdbProvider, type Discovery } from "../src/providers/tmdb";
const movie = (title: string, patch: Partial<Discovery> = {}): Discovery => ({
  tmdbId: 1,
  kind: "movie",
  title,
  overview: "",
  genres: [],
  ...patch,
});
const library = (title: string, patch = {}) =>
  item({ id: title, title, type: "movie", ...patch });
describe("library matching", () => {
  it("normalizes release noise, articles, year tags and punctuation", () => {
    expect(titleKey("The Dark Knight (2008) 1080p BluRay x264")).toBe(
      "dark knight",
    );
    expect(titleKey("Amélie")).toBe("amelie");
    expect(titleKey("Fast & Furious [4K]")).toBe("fast and furious");
  });
  it("matches by title and nearby year, never across kinds", () => {
    const index = buildLibraryIndex([
      library("Dune (2021)", { year: 2021 }),
      library("Dune", { id: "old", year: 1984 }),
      library("Severance", { type: "series" }),
    ]);
    expect(matchDiscovery(movie("Dune", { year: 2021 }), index)?.id).toBe(
      "Dune (2021)",
    );
    expect(matchDiscovery(movie("Dune", { year: 1984 }), index)?.id).toBe(
      "old",
    );
    expect(
      matchDiscovery(movie("Dune", { year: 2000 }), index),
    ).toBeUndefined();
    expect(matchDiscovery(movie("Severance"), index)).toBeUndefined();
    expect(
      matchDiscovery(movie("Severance", { kind: "series" }), index)?.id,
    ).toBe("Severance");
  });
  it("matches by TMDB id when the source supplies one", () => {
    const index = buildLibraryIndex([
      library("Le Fabuleux Destin", { tmdbId: 194, year: 2001 }),
      library("Dune", { id: "other", tmdbId: 999, year: 2021 }),
      library("Show", {
        id: "s",
        type: "series",
        tmdbId: 7,
        availability: "unavailable",
      }),
    ]);
    expect(
      matchDiscovery(movie("Amélie", { tmdbId: 194, year: 2001 }), index)?.id,
    ).toBe("Le Fabuleux Destin");
    // Same title, but the source says it is another TMDB entry.
    expect(
      matchDiscovery(movie("Dune", { tmdbId: 438631, year: 2021 }), index),
    ).toBeUndefined();
    expect(
      matchDiscovery(movie("Anything", { tmdbId: 7, kind: "series" }), index)
        ?.id,
    ).toBe("s");
  });
  it("ignores channels and entries without playable streams", () => {
    const index = buildLibraryIndex([
      item({ title: "Heat" }),
      library("Heat", { availability: "unavailable" }),
    ]);
    expect(matchDiscovery(movie("Heat"), index)).toBeUndefined();
  });
  it("keeps the library item identity when owned and marks the rest as unowned", () => {
    const own = library("Heat", { year: 1995 });
    const index = buildLibraryIndex([own]);
    const owned = discoveryContent(
      movie("Heat", { year: 1995, poster: "https://x/p.jpg", rating: 8.2 }),
      index,
    );
    expect(owned.id).toBe(own.id);
    expect(owned.streams).toEqual(own.streams);
    expect(owned.poster).toBe("https://x/p.jpg");
    const other = discoveryContent(movie("Ronin", { tmdbId: 7 }), index);
    expect(other.id).toBe("tmdb:movie:7");
    expect(other.streams).toEqual([]);
    expect(other.availability).toBe("unavailable");
  });
});
describe("TMDB discovery", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("parses results, drops adult entries and sends v4 tokens as a header", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        results: [
          {
            id: 5,
            title: "Heat",
            release_date: "1995-12-15",
            poster_path: "/a.jpg",
            vote_average: 8.24,
            genre_ids: [28, 80],
            overview: "A thief.",
          },
          { id: 6, title: "Nope", adult: true },
          { id: 7, title: "" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new TmdbProvider("eyJtoken").discover("popular");
    expect(result).toEqual([
      expect.objectContaining({
        tmdbId: 5,
        year: 1995,
        rating: 8.2,
        genres: ["Action", "Crime"],
        poster: "https://image.tmdb.org/t/p/w500/a.jpg",
      }),
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).not.toContain("api_key");
    expect(url).toContain("include_adult=false");
    expect(init.headers).toEqual({ Authorization: "Bearer eyJtoken" });
  });
  it("reports rejected keys", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(new TmdbProvider("bad").discover("top")).rejects.toThrow(
      "rejected",
    );
  });
});
