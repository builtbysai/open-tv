import { afterEach, describe, expect, it, vi } from "vitest";
import { activeLine, parseLrc } from "../src/music/lrc";
import { cleanTrack, fetchAlbum, fetchLyrics } from "../src/music/lookups";

afterEach(() => vi.unstubAllGlobals());
describe("parseLrc", () => {
  it("reads timestamps, several per line, and sorts them", () => {
    const lines = parseLrc(
      "[00:20.50] second\n[00:05.00][00:30.00] repeated\n[ar: Artist]\n",
    );
    expect(lines).toEqual([
      { time: 5, text: "repeated" },
      { time: 20.5, text: "second" },
      { time: 30, text: "repeated" },
    ]);
  });
});
describe("activeLine", () => {
  const lines = parseLrc("[00:05.00] a\n[00:10.00] b\n[00:15.00] c");
  it("finds the line being sung", () => {
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 5)).toBe(0);
    expect(activeLine(lines, 12)).toBe(1);
    expect(activeLine(lines, 99)).toBe(2);
  });
});
describe("cleanTrack", () => {
  it("drops video decoration and splits Artist - Title", () => {
    expect(
      cleanTrack({
        title: "Band - Song (Official Music Video) ft. Guest",
        artist: "BandVEVO",
      }),
    ).toEqual({ artist: "Band", title: "Song" });
    expect(cleanTrack({ title: "Plain Song", artist: "Band" })).toEqual({
      artist: "Band",
      title: "Plain Song",
    });
    expect(
      cleanTrack({ title: "Song [Lyrics]", artist: "Band - Topic" }),
    ).toMatchObject({ title: "Song" });
  });
});
describe("lookups", () => {
  it("returns synced lyrics from LRCLIB", async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({
            syncedLyrics: "[00:01.00] hello",
            plainLyrics: "hello",
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchLyrics({
      id: "abcDEF12345",
      title: "Song",
      artist: "Band",
      duration: 200.4,
    });
    expect(out.synced).toEqual([{ time: 1, text: "hello" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("duration=200");
  });
  it("shows nothing when a lookup misses or fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    expect(
      await fetchLyrics({ id: "abcDEF12345", title: "Song", artist: "Band" }),
    ).toEqual({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    expect(
      await fetchAlbum({ id: "abcDEF12345", title: "Song", artist: "Band" }),
    ).toEqual({});
  });
  it("finds the album, its art and a line about the artist", async () => {
    const release = "11111111-2222-3333-4444-555555555555";
    const artist = "66666666-7777-8888-9999-000000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes("/recording")
                ? {
                    recordings: [
                      {
                        score: 100,
                        releases: [{ id: release, title: "The Album" }],
                        "artist-credit": [{ artist: { id: artist } }],
                      },
                    ],
                  }
                : {
                    type: "Group",
                    country: "GB",
                    "life-span": { begin: "1994-03-01" },
                    disambiguation: "rock band",
                  },
            ),
          ),
      ),
    );
    expect(
      await fetchAlbum({ id: "abcDEF12345", title: "Song", artist: "Band" }),
    ).toEqual({
      album: "The Album",
      artwork: `https://coverartarchive.org/release/${release}/front-500`,
      artistInfo: "Group · GB · since 1994 · rock band",
    });
  });
});

describe("lyrics fallbacks", () => {
  it("searches when the exact lookup misses and takes the closest synced match", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("/api/get"))
          return new Response("", { status: 404 });
        return new Response(
          JSON.stringify([
            { duration: 400, plainLyrics: "far" },
            {
              duration: 201,
              syncedLyrics: "[00:01.00] close",
              plainLyrics: "close",
            },
            { duration: 199, plainLyrics: "plain only" },
          ]),
        );
      }),
    );
    const out = await fetchLyrics({
      id: "abcDEF12345",
      title: "Song (Remix)",
      artist: "Band",
      duration: 200,
    });
    expect(out.synced).toEqual([{ time: 1, text: "close" }]);
    expect(calls.some((c) => c.includes("/api/search"))).toBe(true);
    expect(calls.find((c) => c.includes("/api/search"))).toContain(
      "track_name=Song",
    );
  });
});

import { addLyricsText } from "../src/music/useTrackInfo";
import { readSavedLyrics } from "../src/persistence/music";
describe("lyrics from a file", () => {
  it("accepts timed and plain text and keeps it for the song", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("window", { dispatchEvent: () => true });
    expect(
      addLyricsText("ot-song1", "[00:02.00] hello\\n[00:04.00] world"),
    ).toBe(true);
    expect(readSavedLyrics(localStorage, "ot-song1")).toContain("hello");
    expect(addLyricsText("ot-song2", "   ")).toBe(false);
  });
});
