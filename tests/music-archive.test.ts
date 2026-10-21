import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archive,
  archiveMusicProvider,
  archiveTerms,
  pickTracks,
} from "../src/music/archive";
import {
  MusicClient,
  MusicUnavailableError,
  musicIdOf,
  musicStreamUrl,
} from "../src/music/client";
import { songContent } from "../src/music/content";
import type { MusicApi, MusicProvider } from "../src/music/types";
import { readRecentSongs } from "../src/persistence/music";

const reply = (body: unknown, status = 200) =>
  vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("Internet Archive music", () => {
  it("searches open audio collections in plain words and labels each song", async () => {
    const fetchMock = reply({
      response: {
        docs: [
          {
            identifier: "gd77-05-08.sbd.hicks.4982.sbeok.shnf",
            title: "Grateful Dead Live at Barton Hall on 1977-05-08",
            creator: ["Grateful Dead"],
          },
          { identifier: "bad id!", title: "Bad" },
          { identifier: "notitle" },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const songs = await archive().searchSongs('Dead AND "cornell" *');
    expect(songs).toEqual([
      {
        id: "ia_gd77-05-08.sbd.hicks.4982.sbeok.shnf",
        title: "Grateful Dead Live at Barton Hall on 1977-05-08",
        artist: "Grateful Dead",
        thumbnail:
          "https://archive.org/services/img/gd77-05-08.sbd.hicks.4982.sbeok.shnf",
        source: "Internet Archive",
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(
      "https://archive.org/advancedsearch.php",
    );
    expect(url.searchParams.get("output")).toBe("json");
    expect(url.searchParams.get("rows")).toBe("30");
    expect(url.searchParams.get("q")).toContain("title:(dead and cornell)");
    expect(url.searchParams.get("q")).toContain("collection:etree");
    expect(url.searchParams.get("q")).toContain("mediatype:(audio OR etree)");
    expect(archiveTerms('  "x" OR (y)* ')).toBe("x or y");
    expect(await archive().searchSongs("***")).toEqual([]);
  });
  it("browses the Live Music Archive by this week's plays", async () => {
    const fetchMock = reply({
      response: { docs: [{ identifier: "show1", title: "A show" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await archive().trending()).toHaveLength(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe(
      "collection:etree AND mediatype:etree",
    );
    expect(url.searchParams.get("sort[]")).toBe("week desc");
  });
  it("is told when the service fails", async () => {
    vi.stubGlobal("fetch", reply({}, 503));
    await expect(archive().searchSongs("x")).rejects.toThrow(/503/);
  });
  it("picks the first track, MP3 first and Ogg as the fallback", () => {
    expect(
      pickTracks([
        { name: "show.flac", format: "Flac" },
        { name: "d1t02.mp3", format: "VBR MP3", track: "2" },
        { name: "d1t01.ogg", format: "Ogg Vorbis" },
        { name: "d1t01_sample.mp3", format: "VBR MP3" },
        { name: "d1t01.mp3", format: "VBR MP3", track: "1" },
        { name: "../evil.mp3" },
      ]),
    ).toEqual({ mp3: "d1t01.mp3", ogg: "d1t01.ogg" });
    expect(pickTracks([{ name: "only.ogg" }])).toEqual({
      mp3: undefined,
      ogg: "only.ogg",
    });
    expect(pickTracks([{ name: "cover.jpg" }])).toBeNull();
    expect(pickTracks("nope")).toBeNull();
  });
  it("resolves to direct archive.org download addresses", async () => {
    const fetchMock = reply({
      result: [
        { name: "Disc 1/01 Song.mp3", format: "VBR MP3", track: "1" },
        { name: "Disc 1/01 Song.ogg", format: "Ogg Vorbis" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const streams = await archive().resolveAudio("ia_my.item-1");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://archive.org/metadata/my.item-1/files",
    );
    expect(streams.map((s) => [s.url, s.mime])).toEqual([
      [
        "https://archive.org/download/my.item-1/Disc%201/01%20Song.mp3",
        "audio/mpeg",
      ],
      [
        "https://archive.org/download/my.item-1/Disc%201/01%20Song.ogg",
        "audio/ogg",
      ],
    ]);
    expect(await archive().resolveAudio("abcDEF12345")).toEqual([]);
    expect(archive().embedUrl("ia_my.item-1")).toBeNull();
  });
  it("keeps archive ids playable through placeholders, history and attribution", () => {
    const id = "ia_gd77-05-08.sbd.hicks.4982.sbeok.shnf";
    expect(musicIdOf(musicStreamUrl(id))).toBe(id);
    const c = songContent({
      id,
      title: "Show",
      artist: "Band",
      source: "Internet Archive",
    });
    expect(c.rights.attribution).toBe("Internet Archive");
    expect(c.classification).toBe("general");
    const store = {
      getItem: () =>
        JSON.stringify([{ id, title: "Show", source: "Internet Archive" }]),
    };
    expect(readRecentSongs(store)[0]).toMatchObject({
      id,
      source: "Internet Archive",
    });
  });
});

describe("MusicClient with a built-in provider", () => {
  const song = (id: string) => ({ id, title: id, artist: "" });
  const make = (fail: string[] = []) =>
    new MusicClient(
      (p) =>
        ({
          searchSongs: async () => {
            if (fail.includes(p.id)) throw new Error("down");
            return p.type === "archive"
              ? [song("ia_one"), song("ia_two")]
              : [song("au_abc1"), song("au_abc2")];
          },
          trending: async () => [song(p.type === "archive" ? "ia_t" : "au_t1")],
          playlist: async () => [song("au_pl1")],
          resolveAudio: async () => [
            {
              url: `https://${p.type}.example/a`,
              mime: "audio/mpeg",
              bitrate: 1,
            },
          ],
          embedUrl: () => null,
        }) as MusicApi,
      [archiveMusicProvider],
    );
  const audius: MusicProvider = {
    id: "ot-audius",
    name: "Audius",
    type: "audius",
    base: "https://api.audius.co",
    enabled: true,
  };
  it("works with nothing set up by hand", async () => {
    const client = make();
    const found = await client.search("x");
    expect(found.map((s) => [s.id, s.source])).toEqual([
      ["ia_one", "Internet Archive"],
      ["ia_two", "Internet Archive"],
    ]);
    expect((await client.resolve("ia_one"))[0].url).toBe(
      "https://archive.example/a",
    );
    await expect(client.playlist("PLabcdefghij")).rejects.toMatchObject({
      noProviders: true,
    });
  });
  it("merges every family's answers, each labelled with its provider", async () => {
    const client = make();
    client.setProviders([audius]);
    const found = await client.search("x");
    expect(found.map((s) => [s.id, s.source])).toEqual([
      ["au_abc1", "Audius"],
      ["ia_one", "Internet Archive"],
      ["au_abc2", "Audius"],
      ["ia_two", "Internet Archive"],
    ]);
    expect((await client.trending()).map((s) => s.id)).toEqual([
      "au_t1",
      "ia_t",
    ]);
    expect((await client.resolve("au_abc1"))[0].url).toBe(
      "https://audius.example/a",
    );
    expect(await client.playlist("PLabcdefghij")).toHaveLength(1);
  });
  it("keeps the others when one provider fails", async () => {
    const client = make([archiveMusicProvider.id]);
    client.setProviders([audius]);
    expect((await client.search("x")).map((s) => s.source)).toEqual([
      "Audius",
      "Audius",
    ]);
    const down = make([archiveMusicProvider.id, audius.id]);
    down.setProviders([audius]);
    await expect(down.search("x")).rejects.toBeInstanceOf(
      MusicUnavailableError,
    );
  });
});
