import { afterEach, describe, expect, it, vi } from "vitest";
import { JellyfinProvider } from "../src/providers/jellyfin";
import { canPersistContent } from "../src/domain/library";
import { persistableUrl } from "../src/domain/urls";
afterEach(() => vi.unstubAllGlobals());
const UID = "0123456789abcdef0123456789abcdef";
const TOKEN = "secret-token-xyz";
const auth = () => Response.json({ AccessToken: TOKEN, User: { Id: UID } });
const movie = (n: number, extra: object = {}) => ({
  Id: `aaaaaaaa${String(n).padStart(8, "0")}`,
  Name: `Movie ${n}`,
  ProductionYear: 2020,
  ...extra,
});
function stub(handler: (url: string, init: RequestInit) => Response) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) =>
    handler(String(url), init),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("JellyfinProvider", () => {
  it("rejects bad server addresses", () => {
    expect(() => new JellyfinProvider("ftp://x", "u", "p", "movie")).toThrow();
    expect(
      () => new JellyfinProvider("https://u:p@x.test", "u", "p", "movie"),
    ).toThrow();
    expect(
      () => new JellyfinProvider("https://x.test/?a=1", "u", "p", "movie"),
    ).toThrow();
    expect(
      () => new JellyfinProvider("https://x.test/#a", "u", "p", "movie"),
    ).toThrow();
  });
  it("authenticates with header and body, then maps movies", async () => {
    const fetcher = stub((url) =>
      url.includes("AuthenticateByName")
        ? auth()
        : Response.json({
            TotalRecordCount: 3,
            Items: [
              movie(1, {
                ProviderIds: { Tmdb: "603" },
                DateCreated: "2024-01-02T03:04:05.0000000Z",
                RunTimeTicks: 72_000_000_000,
                CommunityRating: 7.5,
                Genres: ["Action"],
                Overview: "Desc",
              }),
              movie(2, { ProviderIds: { Tmdb: "-4" } }),
              { Id: "../bad", Name: "Bad" },
            ],
          }),
    );
    const p = new JellyfinProvider("https://jf.test/", "me", "pw", "movie");
    const items = await p.load();
    const [authUrl, authInit] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toBe("https://jf.test/Users/AuthenticateByName");
    expect(authInit.method).toBe("POST");
    expect(JSON.parse(authInit.body as string)).toEqual({
      Username: "me",
      Pw: "pw",
    });
    expect(
      (authInit.headers as Record<string, string>)["X-Emby-Authorization"],
    ).toMatch(
      /^MediaBrowser Client="Open TV", Device="Browser", DeviceId="[^"]+", Version="1"$/,
    );
    const [listUrl, listInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(listUrl).toContain(`/Users/${UID}/Items?`);
    expect(listUrl).toContain("IncludeItemTypes=Movie");
    expect((listInit.headers as Record<string, string>)["X-Emby-Token"]).toBe(
      TOKEN,
    );
    expect(listUrl).not.toContain(TOKEN);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "movie",
      tmdbId: 603,
      addedAt: Date.parse("2024-01-02T03:04:05Z"),
      year: 2020,
      rating: 7.5,
      duration: 7200,
      genres: ["Action"],
      availability: "playable",
      rights: { status: "user-authorized" },
    });
    expect(items[0].artwork).toBe(
      `https://jf.test/Items/${items[0].providerItemId}/Images/Primary?maxWidth=500`,
    );
    expect(items[0].streams[0].format).toBe("hls");
    expect(items[0].streams[0].url).toContain("/master.m3u8?MediaSourceId=");
    expect(items[1].tmdbId).toBeUndefined();
  });
  it("keeps the token out of source and persistable data", async () => {
    stub((url) =>
      url.includes("AuthenticateByName")
        ? auth()
        : Response.json({ Items: [movie(1)] }),
    );
    const p = new JellyfinProvider("https://jf.test", "me", "pw", "movie");
    const [item] = await p.load();
    expect(item.streams[0].url).toContain(TOKEN);
    expect(persistableUrl(item.streams[0].url)).toBe(false);
    expect(canPersistContent(item)).toBe(false);
    expect(JSON.stringify(p.source)).not.toContain(TOKEN);
    expect(JSON.stringify(p.source)).not.toContain("pw");
    const rest = { ...item, streams: [] };
    expect(JSON.stringify(rest)).not.toContain(TOKEN);
  });
  it("paginates up to the cap", async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => movie(start + i));
    const fetcher = stub((url) => {
      if (url.includes("AuthenticateByName")) return auth();
      const q = new URL(url).searchParams;
      const start = Number(q.get("StartIndex"));
      return Response.json({
        TotalRecordCount: 9000,
        Items: page(start, Number(q.get("Limit"))),
      });
    });
    const items = await new JellyfinProvider(
      "https://jf.test",
      "me",
      "pw",
      "movie",
    ).load();
    expect(items).toHaveLength(5000);
    const starts = fetcher.mock.calls
      .slice(1)
      .map((c) => new URL(c[0]).searchParams.get("StartIndex"));
    expect(starts).toEqual(["0", "2000", "4000"]);
  });
  it("lists series as unavailable and maps episodes", async () => {
    const sid = "bbbbbbbb-1111-2222-3333-444444444444";
    const fetcher = stub((url) => {
      if (url.includes("AuthenticateByName")) return auth();
      if (url.includes("/Shows/"))
        return Response.json({
          Items: [
            {
              Id: "cccccccc01",
              Name: "Two",
              ParentIndexNumber: 1,
              IndexNumber: 2,
              RunTimeTicks: 18_000_000_000,
            },
            {
              Id: "cccccccc02",
              Name: "One",
              ParentIndexNumber: 1,
              IndexNumber: 1,
            },
            { Id: "bad id", Name: "Bad", ParentIndexNumber: 1, IndexNumber: 3 },
          ],
        });
      return Response.json({ Items: [{ Id: sid, Name: "Show" }] });
    });
    const p = new JellyfinProvider("https://jf.test", "me", "pw", "series");
    const [show] = await p.load();
    expect(show).toMatchObject({
      type: "series",
      availability: "unavailable",
      streams: [],
    });
    const eps = await p.loadEpisodes(show);
    expect(eps.map((e) => e.title)).toEqual(["One", "Two"]);
    expect(eps[1]).toMatchObject({
      type: "episode",
      seriesId: show.id,
      season: 1,
      episode: 2,
      duration: 1800,
    });
    expect(eps[0].streams[0].url).toContain("/Videos/cccccccc02/master.m3u8");
    const url = fetcher.mock.calls.at(-1)![0] as string;
    expect(url).toContain(`/Shows/${sid}/Episodes?`);
    expect(url).toContain(`UserId=${UID}`);
    expect(url).not.toContain(TOKEN);
    await p.loadEpisodes(show);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(p.loadEpisodes({ ...show, id: "other" })).rejects.toThrow();
  });
  it("maps 401 to a friendly authorization error", async () => {
    stub(() => new Response("", { status: 401 }));
    await expect(
      new JellyfinProvider("https://jf.test", "me", "bad", "movie").load(),
    ).rejects.toMatchObject({
      code: "authorization",
      message: expect.stringContaining("username"),
    });
  });
  it("explains CORS/network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(
      new JellyfinProvider("https://jf.test", "me", "pw", "movie").load(),
    ).rejects.toMatchObject({
      code: "network",
      message: expect.stringContaining("CORS"),
    });
  });
  it("blocks HTTP servers from an HTTPS page before any request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("location", { protocol: "https:" });
    await expect(
      new JellyfinProvider("http://jf.test", "me", "pw", "movie").load(),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("dispose aborts pending requests and rejects later use", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => {
        signal = init.signal!;
        return new Promise((_, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason)),
        );
      }),
    );
    const p = new JellyfinProvider("https://jf.test", "me", "pw", "movie");
    const pending = p.load();
    await Promise.resolve();
    p.dispose();
    await expect(pending).rejects.toBeDefined();
    expect(signal!.aborted).toBe(true);
    await expect(p.load()).rejects.toBeDefined();
  });
});
