import { afterEach, describe, expect, it, vi } from "vitest";
import { XtreamProvider } from "../src/providers/xtream";
import { canPersistContent } from "../src/domain/library";
import { sourceFetch } from "../src/providers/http";
import { mixedContent } from "../src/domain/urls";
import { TmdbProvider } from "../src/providers/tmdb";
afterEach(() => vi.unstubAllGlobals());
describe("optional general metadata", () => {
  it("requires explicitly non-adult exact matches and limits artwork to official image paths", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        results: [
          { title: "Film", adult: true, overview: "Restricted" },
          { title: "Film", overview: "Unclassified" },
          { title: 3, adult: false },
          {
            title: "Film",
            adult: false,
            overview: "General description",
            poster_path: "https://untrusted.example/image.jpg",
            backdrop_path: "/official.jpg",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await new TmdbProvider("session-key").lookup(
      "Film",
      "movie",
    );
    expect(result).toEqual({
      description: "General description",
      artwork: undefined,
      backdrop: "https://image.tmdb.org/t/p/w1280/official.jpg",
    });
    expect(Object.keys(result!)).not.toContain("streams");
    expect(fetcher.mock.calls[0]).toEqual([
      expect.stringContaining("include_adult=false"),
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    ]);
  });
  it("bounds metadata response size and does not treat malformed search results as media", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", { headers: { "content-length": "500001" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = new TmdbProvider("session-key");
    await expect(provider.lookup("Film", "movie")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(
      Response.json({ results: { title: "Film" } }),
    );
    expect(await provider.lookup("Film", "movie")).toBeNull();
  });
});
describe("authorized account boundary", () => {
  it("blocks HTTP data requests before sending account information and distinguishes local development", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("location", {
      protocol: "https:",
      href: "https://viewer.example/",
    });
    expect(() =>
      sourceFetch("http://provider.example/player_api.php?password=private"),
    ).toThrow(/HTTPS data endpoint/);
    expect(fetch).not.toHaveBeenCalled();
    expect(mixedContent("/catalog/open-cinema.json")).toBe(false);
    expect(mixedContent("http://provider.example/live", "http:")).toBe(false);
  });
  it("reads TMDB ids and added dates, and flags adult-looking titles", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              calls++ === 0
                ? []
                : [
                    {
                      stream_id: 1,
                      name: "Heat",
                      tmdb: "949",
                      added: "1700000000",
                    },
                    { stream_id: 2, name: "Plain", tmdb: "0", added: "x" },
                    { stream_id: 3, name: "Explicit xxx night" },
                  ],
            ),
            { status: 200 },
          ),
      ),
    );
    const items = await new XtreamProvider(
      "https://provider.test",
      "user",
      "pass",
      "movie",
    ).load();
    expect(items[0]).toMatchObject({ tmdbId: 949, addedAt: 1700000000000 });
    expect(items[1].tmdbId).toBeUndefined();
    expect(items[1].addedAt).toBeUndefined();
    expect(items[2].classification).toBe("adult");
  });
  it("ignores malformed records, detects VOD HLS and keeps account URLs nonpersistable", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              calls++ === 0
                ? [{ category_id: "1", category_name: "Library" }, null]
                : [
                    null,
                    { stream_id: 1, name: 3 },
                    {
                      stream_id: "2",
                      name: "Authorized film",
                      category_id: "1",
                      container_extension: "m3u8",
                    },
                  ],
            ),
            { status: 200 },
          ),
      ),
    );
    const provider = new XtreamProvider(
      "https://provider.test",
      "user",
      "pass",
      "movie",
    );
    const items = await provider.load();
    expect(items).toHaveLength(1);
    expect(items[0].streams[0].format).toBe("hls");
    expect(items[0].classification).toBe("general");
    expect(canPersistContent({ ...items[0], classification: "general" })).toBe(
      false,
    );
  });
  it("rejects server query credentials and propagates cancellation", async () => {
    expect(
      () =>
        new XtreamProvider("https://provider.test?token=abc", "user", "pass"),
    ).toThrow(/query/);
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, options: { signal: AbortSignal }) => {
        options.signal.throwIfAborted();
        return new Response("[]");
      }),
    );
    await expect(
      new XtreamProvider("https://provider.test", "user", "pass").load(
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

describe("on-demand Xtream series", () => {
  const categories = [{ category_id: "4", category_name: "Documentary" }];
  const catalog = [
    {
      series_id: 42,
      name: "Fixture series",
      cover: "javascript:bad",
      category_id: "4",
    },
  ];
  const response = {
    info: { genre: "Documentary" },
    episodes: {
      "2": [
        {
          id: 22,
          episode_num: 1,
          season: 2,
          title: "Next season",
          container_extension: "m3u8",
          info: { duration: "00:24:00" },
        },
      ],
      "1": [
        {
          id: 12,
          episode_num: 2,
          title: "Second episode",
          container_extension: "mp4",
          direct_source: "https://untrusted.test/file.mp4",
          info: { movie_image: "data:image/png,unsafe", duration_secs: "1200" },
        },
        {
          id: 11,
          episode_num: 1,
          title: "First episode",
          container_extension: "../bad",
        },
        { id: 11, episode_num: 1, title: "Duplicate" },
        null,
        { id: "bad", episode_num: 3 },
        { id: 13, episode_num: -1 },
      ],
      "0": [{ id: 1, episode_num: 1, season: 0, title: "Special" }],
    },
  };
  it("loads only series metadata initially, then normalizes ordered seasons, specials and safe episode URLs once", async () => {
    const actions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        const query = new URL(url).searchParams;
        const action = query.get("action")!;
        actions.push(action);
        expect(options.cache).toBe("no-store");
        expect(options.redirect).toBe("error");
        if (action === "get_series_info")
          expect(query.get("series_id")).toBe("42");
        return new Response(
          JSON.stringify(
            action === "get_series_categories"
              ? categories
              : action === "get_series"
                ? catalog
                : response,
          ),
        );
      }),
    );
    const provider = new XtreamProvider(
      "https://provider.test/",
      "user @",
      "secret/",
      "series",
    );
    const [series] = await provider.load();
    expect(actions).toEqual(["get_series_categories", "get_series"]);
    expect(series).toMatchObject({
      type: "series",
      availability: "unavailable",
      streams: [],
      classification: "general",
      providerItemId: "42",
    });
    expect(series.artwork).toBeUndefined();
    const episodes = await provider.loadEpisodes(series);
    expect(episodes.map((e) => [e.season, e.episode])).toEqual([
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    expect(
      episodes.every(
        (e) => e.seriesId === series.id && e.classification === "general",
      ),
    ).toBe(true);
    expect(episodes[2].streams[0].url).toBe(
      "https://provider.test/series/user%20%40/secret%2F/12.mp4",
    );
    expect(episodes[2].duration).toBe(1200);
    expect(episodes[2].artwork).toBeUndefined();
    expect(episodes[3].duration).toBe(1440);
    expect(episodes[3].streams[0].format).toBe("hls");
    expect(
      episodes.every(
        (e) => !canPersistContent({ ...e, classification: "general" }),
      ),
    ).toBe(true);
    expect(await provider.loadEpisodes(series)).toBe(episodes);
    expect(actions.filter((a) => a === "get_series_info")).toHaveLength(1);
    await expect(
      provider.loadEpisodes({ ...series, providerId: "other-account" }),
    ).rejects.toThrow(/this connected account/);
  });
  it("retries invalid episode responses and conservatively inherits explicit classification", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const action = new URL(url).searchParams.get("action");
        return new Response(
          JSON.stringify(
            action === "get_series_categories"
              ? categories
              : action === "get_series"
                ? [{ ...catalog[0], name: "18+ fixture" }]
                : attempt++ === 0
                  ? { error: "not ready" }
                  : response,
          ),
        );
      }),
    );
    const provider = new XtreamProvider(
      "https://provider.test",
      "user",
      "secret",
      "series",
    );
    const [series] = await provider.load();
    await expect(provider.loadEpisodes(series)).rejects.toThrow(
      /valid episode list/,
    );
    const episodes = await provider.loadEpisodes(series);
    expect(
      episodes.every((episode) => episode.classification === "adult"),
    ).toBe(true);
    expect(attempt).toBe(2);
  });
  it("disposes pending requests and refuses further loads after disconnect", async () => {
    let pendingSignal: AbortSignal | undefined;
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        const action = new URL(url).searchParams.get("action");
        if (action !== "get_series_info")
          return new Response(
            JSON.stringify(
              action === "get_series_categories" ? categories : catalog,
            ),
          );
        pendingSignal = options.signal!;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }),
    );
    const provider = new XtreamProvider(
      "https://provider.test",
      "user",
      "secret",
      "series",
    );
    const [series] = await provider.load();
    const request = provider.loadEpisodes(series);
    const rejected = expect(request).rejects.toThrow();
    provider.dispose();
    expect(pendingSignal?.aborted).toBe(true);
    finish(new Response(JSON.stringify(response)));
    await rejected;
    await expect(provider.loadEpisodes(series)).rejects.toThrow();
  });
  it("does not cache a canceled detail request, so reopening can retry", async () => {
    let infoCalls = 0;
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const action = new URL(url).searchParams.get("action");
        if (action !== "get_series_info")
          return new Response(
            JSON.stringify(
              action === "get_series_categories" ? categories : catalog,
            ),
          );
        if (++infoCalls === 1)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return new Response(JSON.stringify(response));
      }),
    );
    const provider = new XtreamProvider(
      "https://provider.test",
      "user",
      "secret",
      "series",
    );
    const [series] = await provider.load();
    const controller = new AbortController();
    const pending = provider.loadEpisodes(series, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    finish(new Response(JSON.stringify(response)));
    await rejected;
    expect(await provider.loadEpisodes(series)).toHaveLength(4);
    expect(infoCalls).toBe(2);
  });
});
