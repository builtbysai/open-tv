import { afterEach, describe, expect, it, vi } from "vitest";
import { RadioBrowserProvider, radioSources } from "../src/providers/radio";
afterEach(() => vi.unstubAllGlobals());
const st = (o: Record<string, unknown>) => ({
  stationuuid: crypto.randomUUID(),
  name: "Station",
  url_resolved: "https://a.example/live",
  tags: "jazz,smooth jazz,lounge,extra",
  countrycode: "US",
  language: "english",
  favicon: "https://a.example/i.png",
  ...o,
});
describe("RadioBrowserProvider", () => {
  it("builds the query and maps https stations only", async () => {
    const fetcher = vi.fn(async (_u: string, _o?: RequestInit) =>
      Response.json([
        st({ name: "Jazz FM" }),
        st({ name: "Plain", url_resolved: "http://a.example/x" }),
        st({ name: "", url_resolved: "https://a.example/y" }),
        st({ name: "NoUrl", url_resolved: "" }),
        st({ name: "jazz  fm!", url_resolved: "https://b.example/z" }),
        st({
          name: "HLS",
          url_resolved: "https://c.example/a.m3u8",
          favicon: "http://x/i.png",
        }),
        st({ name: "HLS2", url_resolved: "https://c.example/b", hls: 1 }),
        st({ name: "Adult XXX" }),
      ]),
    );
    vi.stubGlobal("fetch", fetcher);
    const p = new RadioBrowserProvider({
      id: "r",
      name: "R",
      tag: "jazz",
      country: "us",
    });
    const items = await p.load();
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(
      "https://all.api.radio-browser.info/json/stations/search",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      order: "clickcount",
      reverse: "true",
      hidebroken: "true",
      is_https: "true",
      limit: "150",
      tag: "jazz",
      countrycode: "US",
    });
    expect(items.map((i) => i.title)).toEqual([
      "Jazz FM",
      "HLS",
      "HLS2",
      "Adult XXX",
    ]);
    expect(items[0]).toMatchObject({
      type: "radio",
      genres: ["Jazz", "Smooth Jazz", "Lounge"],
      countries: ["United States"],
      languages: ["English"],
      rights: { status: "provider-listed" },
      streams: [{ format: "audio", url: "https://a.example/live" }],
    });
    expect(items[1].streams[0].format).toBe("hls");
    expect(items[1].artwork).toBeUndefined();
    expect(items[2].streams[0].format).toBe("hls");
    expect(items[3].classification).toBe("adult");
  });
  it("fails on HTTP errors and has presets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(
      new RadioBrowserProvider({ id: "r", name: "R" }).load(),
    ).rejects.toThrow();
    expect(radioSources.map((s) => s.tag)).toEqual([
      undefined,
      "news",
      "jazz",
      "classical",
      "rock",
      "electronic",
    ]);
  });
});
