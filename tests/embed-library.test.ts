import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embedUrl,
  episodeContent,
  libraryContent,
  probeServer,
} from "../src/domain/embed-library";
import type { MediaServer } from "../src/domain/servers";
const server = (id: string, base: string): MediaServer => ({
  id: `ot-${id}`,
  name: id,
  base,
  classification: "general",
  enabled: true,
});
const a = server("alpha", "https://a.example");
const reply = (status: number) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status })),
  );
afterEach(() => vi.unstubAllGlobals());
describe("embed library", () => {
  it("builds the movie and episode paths from the TMDB id", () => {
    expect(embedUrl(a, "movie", 603)).toBe("https://a.example/embed/movie/603");
    expect(embedUrl(a, "series", 1399, 2, 5)).toBe(
      "https://a.example/embed/tv/1399/2/5",
    );
  });
  it("reads availability from the response status", async () => {
    reply(200);
    expect(await probeServer(a, "movie", 1)).toBe("available");
    reply(404);
    expect(await probeServer(a, "movie", 1)).toBe("missing");
    reply(503);
    expect(await probeServer(a, "movie", 1)).toBe("unknown");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("cors");
      }),
    );
    expect(await probeServer(a, "movie", 1)).toBe("unknown");
  });
  it("assumes a server that sends no CORS headers has the title when it answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.mode === "no-cors") return new Response("", { status: 200 });
        throw new TypeError("cors");
      }),
    );
    expect(await probeServer(a, "movie", 1)).toBe("available");
  });
  it("makes a movie playable from every server and a show open to episodes", () => {
    const b = server("beta", "https://b.example");
    const movie = libraryContent(
      { kind: "movie", tmdbId: 603, title: "The Matrix", genres: [] },
      [a, b],
    );
    expect(movie.availability).toBe("playable");
    expect(movie.streams.map((s) => s.url)).toEqual([
      "https://a.example/embed/movie/603",
      "https://b.example/embed/movie/603",
    ]);
    const show = libraryContent(
      { kind: "series", tmdbId: 1399, title: "Show", genres: [] },
      [a],
    );
    expect(show.availability).toBe("unavailable");
    const episode = episodeContent(show, [a], 2, 5, { name: "Pilot" });
    expect(episode).toMatchObject({
      type: "episode",
      seriesId: show.id,
      season: 2,
      episode: 5,
      availability: "playable",
    });
    expect(episode.streams[0].url).toBe("https://a.example/embed/tv/1399/2/5");
  });
});
