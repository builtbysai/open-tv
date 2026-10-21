import { afterEach, describe, expect, it, vi } from "vitest";
import { TvMazeProvider } from "../src/providers/tvmaze";
afterEach(() => vi.unstubAllGlobals());
const show = (id: number, o: Record<string, unknown> = {}) => ({
  id,
  name: `Show ${id}`,
  summary: "<p>Hello <b>&amp; world</b></p>",
  premiered: "2020-05-01",
  genres: ["Drama"],
  rating: { average: 8 },
  image: {
    medium: "http://static.tvmaze.com/m.jpg",
    original: "http://static.tvmaze.com/o.jpg",
  },
  externals: { imdb: "tt123" },
  ...o,
});
describe("TvMazeProvider", () => {
  it("builds trending from schedules, deduping and filtering", async () => {
    const fetcher = vi.fn(async (u: string) =>
      Response.json(
        u.includes("/schedule/web")
          ? [
              { _embedded: { show: show(1) } },
              { _embedded: { show: show(2, { rating: { average: null } }) } },
            ]
          : [
              { show: show(1) },
              { show: show(3, { image: null }) },
              { show: show(4, { rating: { average: 9 } }) },
            ],
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const res = await new TvMazeProvider(0).trending();
    expect(fetcher.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.tvmaze\.com\/schedule\/web\?date=\d{4}-\d\d-\d\d$/,
    );
    expect(fetcher.mock.calls[1][0]).toContain("/schedule?country=US");
    expect(res.map((s) => s.tvmazeId)).toEqual([4, 1]);
    expect(res[1]).toMatchObject({
      overview: "Hello & world",
      poster: "https://static.tvmaze.com/m.jpg",
      backdrop: "https://static.tvmaze.com/o.jpg",
      year: 2020,
      imdb: "tt123",
    });
  });
  it("searches and lists episodes", async () => {
    const fetcher = vi.fn(async (u: string) =>
      Response.json(
        u.includes("/search/")
          ? [{ score: 1, show: show(7) }]
          : [
              {
                season: 1,
                number: 2,
                name: "Ep",
                summary: "<p>S</p>",
                airdate: "2020-01-01",
                runtime: 30,
                image: { medium: "http://x/e.jpg" },
              },
              { name: "special" },
            ],
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const p = new TvMazeProvider(0);
    expect((await p.search("a b&c"))[0].tvmazeId).toBe(7);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.tvmaze.com/search/shows?q=a+b%26c",
    );
    expect(await p.episodes(7)).toEqual([
      {
        season: 1,
        number: 2,
        name: "Ep",
        summary: "S",
        airdate: "2020-01-01",
        runtime: 30,
        image: "https://x/e.jpg",
      },
    ]);
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.tvmaze.com/shows/7/episodes",
    );
  });
  it("throws rate-limited on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    await expect(new TvMazeProvider(0).search("x")).rejects.toThrow(
      "rate-limited",
    );
  });
});
