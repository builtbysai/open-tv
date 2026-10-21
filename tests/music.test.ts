import { afterEach, describe, expect, it, vi } from "vitest";
import { invidious } from "../src/music/invidious";
import { piped } from "../src/music/piped";
import { audius } from "../src/music/audius";
import { rankAudio } from "../src/music/audio";
import { failureReason } from "../src/music/http";
import {
  MusicClient,
  MusicUnavailableError,
  musicIdOf,
  musicStreamUrl,
} from "../src/music/client";
import type { MusicApi, MusicProvider } from "../src/music/types";
import { validateMusicProvider } from "../src/persistence/music";

const reply = (body: unknown, status = 200) =>
  vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("invidious", () => {
  it("reads songs, picks a thumbnail and drops other result types", async () => {
    const fetchMock = reply([
      {
        type: "video",
        videoId: "abcDEF12345",
        title: "Song",
        author: "Band - Topic",
        lengthSeconds: 215,
        videoThumbnails: [
          { quality: "default", url: "/vi/abc/default.jpg" },
          { quality: "medium", url: "/vi/abc/mq.jpg" },
        ],
      },
      { type: "channel", author: "Someone" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const songs = await invidious("https://inv.example/").searchSongs("band");
    expect(songs).toEqual([
      {
        id: "abcDEF12345",
        title: "Song",
        artist: "Band",
        thumbnail: "https://inv.example/vi/abc/mq.jpg",
        duration: 215,
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://inv.example/api/v1/search?q=band&type=video",
    );
  });
  it("asks for instance-proxied audio and ranks the formats", async () => {
    const fetchMock = reply({
      adaptiveFormats: [
        {
          type: 'video/mp4; codecs="avc1"',
          url: "https://inv.example/v",
          bitrate: 900000,
        },
        {
          type: 'audio/webm; codecs="opus"',
          url: "https://inv.example/a-opus",
          bitrate: 160000,
        },
        {
          type: 'audio/mp4; codecs="mp4a"',
          url: "https://inv.example/a-aac",
          bitrate: 128000,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const streams = await invidious("https://inv.example").resolveAudio(
      "abcDEF12345",
    );
    expect(streams.map((s) => s.url)).toEqual([
      "https://inv.example/a-aac",
      "https://inv.example/a-opus",
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("local=true");
  });
  it("builds an audio-only embed address", () => {
    expect(invidious("https://inv.example").embedUrl("abcDEF12345")).toBe(
      "https://inv.example/embed/abcDEF12345?listen=1&autoplay=1",
    );
  });
});
describe("piped", () => {
  it("reads music search results and playlist entries", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        items: [
          {
            url: "/watch?v=abcDEF12345",
            title: "Song",
            uploaderName: "Band",
            thumbnail: "https://img.example/a.jpg",
            duration: 200,
          },
        ],
        relatedStreams: [
          {
            url: "/watch?v=zzzDEF12345",
            title: "Two",
            uploaderName: "Band",
            duration: -1,
          },
        ],
      }),
    );
    const api = piped("https://api.example");
    expect((await api.searchSongs("x"))[0]).toMatchObject({
      id: "abcDEF12345",
      artist: "Band",
      duration: 200,
    });
    expect((await api.playlist("PL1"))[0]).toMatchObject({
      id: "zzzDEF12345",
      duration: undefined,
    });
  });
  it("lists audio streams best first", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        audioStreams: [
          {
            url: "https://p.example/low",
            mimeType: "audio/mp4",
            bitrate: 48000,
          },
          {
            url: "https://p.example/high",
            mimeType: "audio/mp4",
            bitrate: 128000,
          },
          {
            url: "http://p.example/insecure",
            mimeType: "audio/mp4",
            bitrate: 999000,
          },
        ],
      }),
    );
    const streams = await piped("https://api.example").resolveAudio(
      "abcDEF12345",
    );
    expect(streams.map((s) => s.url)).toEqual([
      "https://p.example/high",
      "https://p.example/low",
    ]);
  });
  it("is told when the service fails", async () => {
    vi.stubGlobal("fetch", reply({}, 500));
    await expect(piped("https://api.example").trending()).rejects.toThrow(
      /500/,
    );
  });
});
describe("rankAudio", () => {
  it("puts AAC first, then Opus, then the rest, by bitrate", () => {
    const out = rankAudio([
      { url: "a", mime: "audio/ogg", bitrate: 999 },
      { url: "b", mime: "audio/webm", bitrate: 160 },
      { url: "c", mime: "audio/mp4", bitrate: 64 },
      { url: "d", mime: "audio/mp4", bitrate: 128 },
    ]);
    expect(out.map((s) => s.url)).toEqual(["d", "c", "b", "a"]);
  });
});

const provider = (id: string, enabled = true): MusicProvider => ({
  id: `ot-${id}`,
  name: id,
  type: "invidious",
  base: `https://${id}.example`,
  enabled,
});
const fakeApi =
  (behaviour: Record<string, () => Promise<unknown>>) => (p: MusicProvider) =>
    ({
      searchSongs: () => behaviour[p.id]() as never,
      resolveAudio: () => behaviour[p.id]() as never,
      trending: () => behaviour[p.id]() as never,
      playlist: () => behaviour[p.id]() as never,
      embedUrl: (id: string) => `${p.base}/embed/${id}`,
    }) as MusicApi;
describe("MusicClient", () => {
  it("tries the next provider when one fails", async () => {
    const calls: string[] = [];
    const client = new MusicClient(
      fakeApi({
        "ot-a": async () => {
          calls.push("a");
          throw new Error("dead");
        },
        "ot-b": async () => {
          calls.push("b");
          return [{ id: "abcDEF12345", title: "T", artist: "A" }];
        },
      }),
    );
    client.setProviders([provider("a"), provider("b")]);
    expect(await client.search("x")).toHaveLength(1);
    expect(calls).toEqual(["a", "b"]);
  });
  it("skips disabled providers and reports when none are set up", async () => {
    const client = new MusicClient(fakeApi({}));
    client.setProviders([provider("a", false)]);
    await expect(client.search("x")).rejects.toMatchObject({
      noProviders: true,
    });
  });
  it("says so when every provider fails", async () => {
    const client = new MusicClient(
      fakeApi({
        "ot-a": async () => {
          throw new Error("x");
        },
        "ot-b": async () => {
          throw new Error("y");
        },
      }),
    );
    client.setProviders([provider("a"), provider("b")]);
    const error = await client.search("x").catch((e) => e);
    expect(error).toBeInstanceOf(MusicUnavailableError);
    expect(error.noProviders).toBe(false);
  });
  it("treats a provider with no audio as failed and remembers resolved audio", async () => {
    let calls = 0;
    const client = new MusicClient(
      fakeApi({
        "ot-a": async () => [],
        "ot-b": async () => {
          calls++;
          return [
            { url: "https://b.example/audio", mime: "audio/mp4", bitrate: 1 },
          ];
        },
      }),
    );
    client.setProviders([provider("a"), provider("b")]);
    expect((await client.resolve("abcDEF12345"))[0].url).toBe(
      "https://b.example/audio",
    );
    await client.resolve("abcDEF12345");
    expect(calls).toBe(1);
  });
  it("turns a placeholder address into the real audio address", async () => {
    const client = new MusicClient(
      fakeApi({
        "ot-a": async () => [
          { url: "https://a.example/real", mime: "audio/mp4", bitrate: 1 },
        ],
      }),
    );
    client.setProviders([provider("a")]);
    const url = musicStreamUrl("abcDEF12345");
    expect(musicIdOf(url)).toBe("abcDEF12345");
    expect(await client.resolveUrl(url, new AbortController().signal)).toBe(
      "https://a.example/real",
    );
    expect(
      await client.resolveUrl(
        "https://other.example/x.mp3",
        new AbortController().signal,
      ),
    ).toBe("https://other.example/x.mp3");
  });
  it("leaves a provider out for a while after repeated failures", async () => {
    const calls: string[] = [];
    const client = new MusicClient(
      fakeApi({
        "ot-a": async () => {
          calls.push("a");
          throw new Error("dead");
        },
        "ot-b": async () => {
          calls.push("b");
          return [];
        },
      }),
    );
    client.setProviders([provider("a"), provider("b")]);
    for (let i = 0; i < 4; i++) await client.search("x");
    expect(calls.filter((c) => c === "a")).toHaveLength(3);
  });
});
describe("validateMusicProvider", () => {
  it("needs an id, a name, a known type and a plain address", () => {
    const ok = {
      id: "ot-a1",
      name: " Mine ",
      type: "piped",
      base: "https://api.example/",
      enabled: true,
    };
    expect(validateMusicProvider(ok)).toMatchObject({
      name: "Mine",
      base: "https://api.example",
    });
    expect(validateMusicProvider({ ...ok, type: "other" })).toBeNull();
    expect(
      validateMusicProvider({ ...ok, base: "https://u:p@api.example" }),
    ).toBeNull();
    expect(
      validateMusicProvider({ ...ok, base: "https://api.example/?x=1" }),
    ).toBeNull();
    expect(validateMusicProvider({ ...ok, id: "bad id" })).toBeNull();
  });
});
import { playlistIdFrom, songContent } from "../src/music/content";
describe("music content", () => {
  it("makes a song playable audio with a placeholder address", () => {
    const c = songContent({
      id: "abcDEF12345",
      title: "Song",
      artist: "Band",
      duration: 200,
    });
    expect(c).toMatchObject({
      type: "audio",
      availability: "playable",
      artist: "Band",
      providerId: "music",
    });
    expect(musicIdOf(c.streams[0].url)).toBe("abcDEF12345");
  });
  it("finds a playlist id in an id or an address", () => {
    expect(playlistIdFrom("PLabcdefghij123")).toBe("PLabcdefghij123");
    expect(
      playlistIdFrom("https://site.example/playlist?list=PLabcdefghij123&x=1"),
    ).toBe("PLabcdefghij123");
    expect(playlistIdFrom("not a playlist")).toBeNull();
  });
});

describe("failureReason", () => {
  it("explains a failed check in plain words", () => {
    expect(failureReason(new TypeError("Failed to fetch"))).toMatch(/CORS/);
    expect(failureReason(new Error("The music service answered 403."))).toMatch(
      /API turned off/,
    );
    expect(failureReason(new Error("The music service answered 502."))).toMatch(
      /failing \(502\)/,
    );
    expect(failureReason(new Error("x"))).toMatch(/not with music data/);
  });
});

describe("audius", () => {
  it("reads tracks with prefixed ids and builds the stream address", async () => {
    const fetchMock = reply({
      data: [
        {
          id: "vZJJz",
          title: "Track",
          duration: 190,
          is_streamable: true,
          user: { name: "Artist" },
          artwork: { "480x480": "https://cdn.example/a.jpg" },
        },
        { id: "gone1", title: "Removed", is_delete: true },
        { id: "bad id", title: "Bad" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = audius("https://api.audius.co/");
    expect(await api.searchSongs("daft punk")).toEqual([
      {
        id: "au_vZJJz",
        title: "Track",
        artist: "Artist",
        thumbnail: "https://cdn.example/a.jpg",
        duration: 190,
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/tracks/search?");
    const [stream] = await api.resolveAudio("au_vZJJz");
    expect(stream.url).toBe(
      "https://api.audius.co/v1/tracks/vZJJz/stream?app_name=opentv",
    );
    expect(api.embedUrl("au_vZJJz")).toBeNull();
  });
  it("asks only the matching kind of provider for a song's audio", async () => {
    const asked: string[] = [];
    const client = new MusicClient((p) => ({
      searchSongs: async () => [],
      trending: async () => [],
      playlist: async () => [],
      embedUrl: () => null,
      resolveAudio: async () => {
        asked.push(p.id);
        return [{ url: "https://a.example/x", mime: "audio/mpeg", bitrate: 1 }];
      },
    }));
    client.setProviders([
      { ...provider("video"), type: "invidious" },
      { ...provider("open"), type: "audius" },
    ]);
    await client.resolve("au_vZJJz");
    await client.resolve("abcDEF12345");
    expect(asked).toEqual(["ot-open", "ot-video"]);
  });
});
