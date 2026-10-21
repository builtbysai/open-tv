import { describe, expect, it } from "vitest";
import {
  importServers,
  serverMediaUrl,
  validTemplate,
  validateServer,
  type MediaServer,
} from "../src/domain/servers";

const server = (extra: Partial<MediaServer> = {}): MediaServer => ({
  id: "ot-test",
  name: "Test",
  base: "https://srv.example",
  classification: "general",
  enabled: true,
  ...extra,
});
describe("server address formats", () => {
  it("keeps the usual layout by default", () => {
    expect(
      serverMediaUrl(server(), { type: "movie", providerItemId: "603" }),
    ).toBe("https://srv.example/embed/movie/603");
    expect(
      serverMediaUrl(server(), {
        type: "episode",
        providerItemId: "1396",
        season: 1,
        episode: 2,
      }),
    ).toBe("https://srv.example/embed/tv/1396/1/2");
  });
  it("follows a server's own pattern, including query parameters", () => {
    const custom = server({
      movie: "{base}/embed?tmdb={id}",
      episode: "{base}/embed?tmdb={id}&season={season}&episode={episode}",
    });
    expect(
      serverMediaUrl(custom, { type: "movie", providerItemId: "603" }),
    ).toBe("https://srv.example/embed?tmdb=603");
    expect(
      serverMediaUrl(custom, {
        type: "episode",
        providerItemId: "1396",
        season: 3,
        episode: 4,
      }),
    ).toBe("https://srv.example/embed?tmdb=1396&season=3&episode=4");
  });
  it("refuses patterns that leave the server or miss placeholders", () => {
    expect(validTemplate("https://other.example/{id}", false)).toBeNull();
    expect(validTemplate("{base}/movie", false)).toBeNull();
    expect(validTemplate("{base}/tv/{id}", true)).toBeNull();
    expect(validTemplate("{base}/x/{id}/{evil}", false)).toBeNull();
    expect(validTemplate("{base}@evil.example/{id}", false)).toBeNull();
    expect(validTemplate("{base}/tv/{id}-{season}-{episode}", true)).toBe(
      "{base}/tv/{id}-{season}-{episode}",
    );
  });
  it("drops an invalid stored pattern but keeps the server", () => {
    const saved = validateServer({
      ...server(),
      movie: "https://evil.example/{id}",
    });
    expect(saved?.movie).toBeUndefined();
    expect(saved?.base).toBe("https://srv.example");
  });
});
describe("importing servers", () => {
  it("accepts a list or { servers }, gives fresh ids and starts them off", () => {
    const list = importServers({
      servers: [
        { name: "A", base: "https://a.example", movie: "{base}/m/{id}" },
        { name: "", base: "https://b.example" },
        { name: "C", base: "not a url" },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "A",
      base: "https://a.example",
      enabled: false,
      movie: "{base}/m/{id}",
    });
    expect(
      importServers([{ name: "D", base: "https://d.example" }]),
    ).toHaveLength(1);
    expect(importServers("junk")).toEqual([]);
  });
});

describe("the default server address", () => {
  it("is /embed/movie/{id} and /embed/tv/{id}/{season}/{episode} unless a server states its own", async () => {
    const {
      DEFAULT_MOVIE,
      DEFAULT_EPISODE,
      importServers: load,
    } = await import("../src/domain/servers");
    expect(DEFAULT_MOVIE).toBe("{base}/embed/movie/{id}");
    expect(DEFAULT_EPISODE).toBe("{base}/embed/tv/{id}/{season}/{episode}");
    // A server from a file or an extension without a format gets the default.
    const [plain] = load([{ name: "Plain", base: "https://plain.example" }]);
    expect(plain.movie).toBeUndefined();
    expect(serverMediaUrl(plain, { type: "movie", providerItemId: "1" })).toBe(
      "https://plain.example/embed/movie/1",
    );
    expect(
      serverMediaUrl(plain, {
        type: "anime",
        providerItemId: "2",
        season: 0,
        episode: 5,
      }),
    ).toBe("https://plain.example/embed/tv/2/0/5");
  });
});
