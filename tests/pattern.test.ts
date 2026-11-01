import { describe, expect, it } from "vitest";
import {
  DEFAULT_EPISODE,
  DEFAULT_MOVIE,
  fillPattern,
  validPattern,
} from "../src/modules/movies/pattern";
import {
  embedUrl,
  importServers,
  normalizeBase,
  previewUrls,
  validateServer,
} from "../src/modules/movies/servers";

const app = { origin: "https://tv.example.com", protocol: "https:" };
const server = { base: "https://play.example.org", sandbox: false };

describe("server pattern", () => {
  it("uses the default layout", () => {
    expect(embedUrl(server, { kind: "movie", id: "603" })).toBe(
      "https://play.example.org/embed/movie/603",
    );
    expect(
      embedUrl(server, { kind: "episode", id: "1396", season: 1, episode: 2 }),
    ).toBe("https://play.example.org/embed/tv/1396/1/2");
    expect(DEFAULT_MOVIE).toBe("{base}/embed/movie/{id}");
    expect(DEFAULT_EPISODE).toBe("{base}/embed/tv/{id}/{season}/{episode}");
  });

  it("supports custom patterns, season zero and a start time", () => {
    const custom = {
      base: "https://play.example.org/v2",
      movie: "{base}/embed?tmdb={id}&t={start}",
      episode: "{base}/tv/{id}-{season}-{episode}",
    };
    expect(embedUrl(custom, { kind: "movie", id: "603", start: 90 })).toBe(
      "https://play.example.org/v2/embed?tmdb=603&t=90",
    );
    expect(
      embedUrl(custom, { kind: "episode", id: "1396", season: 0, episode: 1 }),
    ).toBe("https://play.example.org/v2/tv/1396-0-1");
  });

  it("rejects patterns that could leave the server's origin", () => {
    for (const bad of [
      "https://evil.example/{id}",
      "{base}@evil.example/{id}",
      "{base}.evil.example/{id}",
      "{base}:8080/{id}",
      "{base}/x/{id}/{other}",
      "{base}/x",
      "{base}{base}/{id}",
      "{base}/javascript:{id}",
    ])
      expect(validPattern(bad, "movie")).toBeNull();
    expect(validPattern("{base}/e/{id}", "episode")).toBeNull(); // needs season and episode
    expect(validPattern("{base}/e/{id}/{season}/{episode}", "episode")).not.toBeNull();
  });

  it("refuses ids that are not plain", () => {
    expect(fillPattern(DEFAULT_MOVIE, server.base, { id: "../admin" })).toBeNull();
    expect(fillPattern(DEFAULT_MOVIE, server.base, { id: "tt0133093" })).not.toBeNull();
  });

  it("refuses an episode address with a missing or bad season/episode", () => {
    const b = server.base;
    expect(fillPattern(DEFAULT_EPISODE, b, { id: "1396" })).toBeNull();
    expect(fillPattern(DEFAULT_EPISODE, b, { id: "1396", season: 1 })).toBeNull();
    expect(fillPattern(DEFAULT_EPISODE, b, { id: "1396", season: 1, episode: -1 })).toBeNull();
    expect(fillPattern(DEFAULT_EPISODE, b, { id: "1396", season: 1, episode: 2 })).toBe(`${b}/embed/tv/1396/1/2`);
    // A movie pattern does not use them, so they are not needed.
    expect(fillPattern(DEFAULT_MOVIE, b, { id: "603" })).toBe(`${b}/embed/movie/603`);
  });

  it("previews TMDB's sample film and episode", () => {
    expect(previewUrls(server)).toEqual({
      movie: "https://play.example.org/embed/movie/603",
      episode: "https://play.example.org/embed/tv/1396/1/1",
    });
  });
});

describe("server address", () => {
  it("adds https and strips the trailing slash", () => {
    expect(normalizeBase("play.example.org/", app)).toEqual({
      base: "https://play.example.org",
    });
  });
  it("explains what it rejects", () => {
    expect(normalizeBase("", app)).toHaveProperty("error");
    expect(normalizeBase("https://user:pw@play.example.org", app)).toHaveProperty("error");
    expect(normalizeBase("https://play.example.org/?a=1", app)).toHaveProperty("error");
    expect(normalizeBase("ftp://play.example.org", app)).toHaveProperty("error");
    expect(normalizeBase("https://tv.example.com", app)).toHaveProperty("error");
  });
  it("blocks http from an https app, except on this machine", () => {
    expect(normalizeBase("http://192.168.1.5:8080", app)).toHaveProperty("error");
    expect(normalizeBase("http://127.0.0.1:8080", app)).toEqual({
      base: "http://127.0.0.1:8080",
    });
    expect(
      normalizeBase("http://192.168.1.5:8080", { origin: "http://x", protocol: "http:" }),
    ).toEqual({ base: "http://192.168.1.5:8080" });
  });
});

describe("server records", () => {
  it("validates a record and defaults the optional parts", () => {
    const s = validateServer({ id: "abcd1234", name: " Main ", base: "https://play.example.org/" }, app);
    expect(s).toMatchObject({
      id: "abcd1234",
      name: "Main",
      base: "https://play.example.org",
      sandbox: false,
      enabled: true,
      bridge: "unknown",
    });
  });
  it("rejects a record whose pattern is invalid instead of falling back", () => {
    expect(
      validateServer(
        { id: "abcd1234", name: "x", base: "https://play.example.org", movie: "https://evil/{id}" },
        app,
      ),
    ).toBeNull();
  });
  it("imports servers disabled, with fresh ids", () => {
    let n = 0;
    const list = importServers(
      { servers: [{ name: "A", base: "https://a.example.org" }, { name: "bad", base: "" }] },
      () => `id${++n}abcd`,
      app,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: false, id: "id1abcd" });
  });
});
