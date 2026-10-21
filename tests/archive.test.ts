import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArchiveProvider,
  archiveSources,
  pickFile,
  searchUrl,
} from "../src/providers/archive";

afterEach(() => vi.unstubAllGlobals());
const make = (
  collection = "feature_films",
  mediatype: "movies" | "audio" = "movies",
) =>
  new ArchiveProvider({
    collection,
    mediatype,
    name: "Test",
    id: "archive-test",
  });

describe("archive search", () => {
  it("builds the advancedsearch URL with encoded parameters", () => {
    const url = new URL(searchUrl("feature_films", "movies", 60));
    expect(url.origin + url.pathname).toBe(
      "https://archive.org/advancedsearch.php",
    );
    expect(url.searchParams.get("q")).toBe(
      "collection:feature_films AND mediatype:movies",
    );
    expect(url.searchParams.getAll("fl[]")).toContain("licenseurl");
    expect(url.searchParams.get("sort[]")).toBe("downloads desc");
    expect(url.searchParams.get("rows")).toBe("60");
    expect(url.searchParams.get("output")).toBe("json");
  });

  it("maps records, drops bad ones and sanitizes text", async () => {
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      Response.json({
        response: {
          docs: [
            {
              identifier: "good-film",
              title: "Good Film",
              year: "1931",
              description:
                "<p>A <b>classic</b> &amp; fun</p><script>x()</script>",
            },
            { identifier: "no-title" },
            { identifier: "bad id/../", title: "Bad" },
            { identifier: "good-film", title: "Duplicate" },
            { identifier: 5, title: "Numeric" },
            {
              identifier: "cc-film",
              title: "x".repeat(900),
              licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/",
            },
            "junk",
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const items = await make("somewhere").load();
    expect(items.map((i) => i.providerItemId)).toEqual([
      "good-film",
      "cc-film",
    ]);
    const [film, cc] = items;
    expect(film).toMatchObject({
      type: "movie",
      availability: "external",
      streams: [],
      externalUrl: "https://archive.org/details/good-film",
      artwork: "https://archive.org/services/img/good-film",
      year: 1931,
      description: "A classic & fun",
      rights: {
        status: "unverified",
        attribution: "Internet Archive",
        url: "https://archive.org/details/good-film",
      },
    });
    expect(cc.title.length).toBe(200);
    expect(cc.rights.status).toBe("public-domain");
    expect(fetcher.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("treats known collections as public domain, audio as on-demand audio, and classifies adult text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          response: {
            docs: [
              { identifier: "a", title: "Show" },
              { identifier: "b", title: "XXX show" },
            ],
          },
        }),
      ),
    );
    const items = await make("oldtimeradio", "audio").load();
    expect(items[0].type).toBe("audio");
    expect(items[0].rights.status).toBe("public-domain");
    expect(items[1].classification).toBe("adult");
  });

  it("rejects HTTP errors, malformed bodies and oversize responses", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(new Response("no", { status: 503 }));
    await expect(make().load()).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response("not json"));
    await expect(make().load()).rejects.toThrow();
    fetcher.mockResolvedValueOnce(Response.json({ response: { docs: {} } }));
    await expect(make().load()).rejects.toThrow();
    fetcher.mockResolvedValueOnce(
      new Response("{}", { headers: { "content-length": "99999999" } }),
    );
    await expect(make().load()).rejects.toThrow();
    expect(() => make("bad collection!")).toThrow();
  });
});

describe("archive file selection", () => {
  it("prefers h.264 mp4 under the size cap, then webm/ogv", () => {
    const files = [
      { name: "a.ogv", format: "Ogg Video", size: "10" },
      { name: "a.webm", format: "WebM", size: "10" },
      { name: "a.mpg", format: "MPEG2", size: "10" },
      { name: "big.mp4", format: "h.264", size: "2000000000" },
      { name: "a.mp4", format: "MPEG4", size: "100" },
      { name: "b.mp4", format: "h.264", size: "200" },
    ];
    expect(pickFile(files, "movies")).toEqual({
      name: "b.mp4",
      format: "video",
    });
    expect(pickFile(files.slice(0, 3), "movies")?.name).toBe("a.webm");
    expect(pickFile(files.slice(0, 1), "movies")?.name).toBe("a.ogv");
    expect(pickFile([files[2], files[3]], "movies")?.name).toBe("big.mp4");
    expect(pickFile([files[2]], "movies")).toBeNull();
    expect(pickFile("x", "movies")).toBeNull();
  });
  it("prefers VBR MP3 for audio and skips unsafe names", () => {
    const files = [
      { name: "a_64kb.mp3", format: "64Kbps MP3" },
      { name: "a.mp3", format: "VBR MP3" },
      { name: "../evil.mp3", format: "VBR MP3" },
      { name: "a.ogg", format: "Ogg Vorbis" },
    ];
    expect(pickFile(files, "audio")).toEqual({
      name: "a.mp3",
      format: "audio",
    });
  });
});

describe("archive resolve", () => {
  it("upgrades an external item to playable with an encoded download URL", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          response: { docs: [{ identifier: "good-film", title: "Good" }] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          files: [{ name: "My Film #1.mp4", format: "h.264", size: "500" }],
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const provider = make();
    const [item] = await provider.load();
    const resolved = await provider.resolve(item);
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://archive.org/metadata/good-film",
    );
    expect(resolved.availability).toBe("playable");
    expect(resolved.streams[0]).toMatchObject({
      url: "https://archive.org/download/good-film/My%20Film%20%231.mp4",
      format: "video",
    });
    expect(item.availability).toBe("external");
  });
  it("leaves the item external without playable files and rejects bad ids", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          response: { docs: [{ identifier: "x1", title: "T" }] },
        }),
      )
      .mockResolvedValueOnce(Response.json({ files: [] }));
    vi.stubGlobal("fetch", fetcher);
    const provider = make();
    const [base] = await provider.load();
    expect((await provider.resolve(base)).availability).toBe("external");
    await expect(
      provider.resolve({ ...base, providerItemId: "../x" }),
    ).rejects.toThrow();
  });
});

describe("archive presets", () => {
  it("exports valid presets", () => {
    expect(archiveSources.map((s) => s.id)).toContain("archive-feature-films");
    for (const s of archiveSources)
      expect(() => new ArchiveProvider({ ...s })).not.toThrow();
  });
});

describe("archive subject searches", () => {
  it("narrows a collection to a quoted subject", async () => {
    const { searchUrl } = await import("../src/providers/archive");
    const url = decodeURIComponent(
      searchUrl("feature_films", "movies", 10, 'film "noir"').replace(
        /\+/g,
        " ",
      ),
    );
    expect(url).toContain('subject:"film noir"');
    expect(searchUrl("feature_films", "movies", 10)).not.toContain("subject");
  });
});

describe("pickFile start speed", () => {
  const file = (name: string, size: number) => ({
    name,
    format: "h.264",
    size: String(size),
  });
  it("prefers the larger file only while it still starts quickly", () => {
    expect(
      pickFile(
        [
          file("hd.mp4", 900_000_000),
          file("mid.mp4", 200_000_000),
          file("low.mp4", 50_000_000),
        ],
        "movies",
      )?.name,
    ).toBe("mid.mp4");
    expect(
      pickFile(
        [file("hd.mp4", 900_000_000), file("huge.mp4", 1_200_000_000)],
        "movies",
      )?.name,
    ).toBe("hd.mp4");
  });
});
