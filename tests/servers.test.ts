import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import { libraryContent } from "../src/domain/embed-library";
import {
  serverAddress,
  validateServer,
  resolveServerMedia,
  serverMediaUrl,
  type MediaServer,
} from "../src/domain/servers";
import {
  readServers,
  writeServers,
  SERVERS_KEY,
} from "../src/persistence/servers";
import { validateContent } from "../src/providers/catalog";
const server: MediaServer = {
  id: "ot-server",
  name: "Home cinema",
  base: "https://server.test/media",
  classification: "general",
  enabled: true,
};
describe("media server boundaries", () => {
  it("rejects credential, query, fragment and executable addresses and projects allowed fields", () => {
    for (const address of [
      "javascript:alert(1)",
      "https://user:secret@server.test",
      "https://server.test?token=secret",
      "https://server.test/#fragment",
    ])
      expect(serverAddress(address)).toBeNull();
    expect(serverAddress("https://server.test/media///")).toBe(
      "https://server.test/media",
    );
    expect(validateServer({ ...server, password: "secret" })).toEqual(server);
    expect(validateServer({ ...server, id: "raw-secret" })).toBeNull();
    // The classification you chose is kept; a name never moves a server.
    expect(
      validateServer({ ...server, name: "18+ fixture" })?.classification,
    ).toBe("general");
  });
  it("rebuilds linked streams under the same title identity, supports Specials and never substitutes another server", () => {
    const original = item({
      type: "movie",
      serverId: server.id,
      providerItemId: "tt123",
      streams: [],
    });
    const resolved = resolveServerMedia(original, [server]);
    expect(resolved.id).toBe(original.id);
    expect(resolved.streams[0].url).toBe(
      "https://server.test/media/embed/movie/tt123",
    );
    const edited = resolveServerMedia(original, [
      { ...server, base: "https://replacement.test" },
    ]);
    expect(edited.id).toBe(original.id);
    expect(edited.streams[0].url).toBe(
      "https://replacement.test/embed/movie/tt123",
    );
    expect(
      serverMediaUrl(server, {
        type: "anime",
        providerItemId: "series-1",
        season: 0,
        episode: 2,
      }),
    ).toBe("https://server.test/media/embed/tv/series-1/0/2");
    for (const definitions of [
      [{ ...server, enabled: false }],
      [{ ...server, id: "ot-other" }],
      [],
    ]) {
      expect(resolveServerMedia(original, definitions)).toMatchObject({
        id: original.id,
        availability: "unavailable",
        streams: [],
      });
    }
    expect(() =>
      serverMediaUrl(server, { type: "movie", providerItemId: "../secret" }),
    ).toThrow();
    expect(() =>
      serverMediaUrl(server, {
        type: "episode",
        providerItemId: "12",
        season: -1,
        episode: 1,
      }),
    ).toThrow();
  });
  it("cascades restricted server classifications and rejects malformed server references at import", () => {
    const linked = item({
      serverId: server.id,
      providerItemId: "12",
      type: "movie",
    });
    expect(
      resolveServerMedia(linked, [{ ...server, classification: "adult" }])
        .classification,
    ).toBe("adult");
    expect(
      resolveServerMedia(linked, [{ ...server, classification: "unknown" }])
        .classification,
    ).toBe("unknown");
    expect(
      resolveServerMedia({ ...linked, classification: "adult" }, [server])
        .classification,
    ).toBe("adult");
    expect(validateContent([linked])[0].serverId).toBe(server.id);
    expect(validateContent([{ ...linked, serverId: "invalid" }])).toEqual([]);
    expect(validateContent([{ ...linked, providerItemId: "bad/id" }])).toEqual(
      [],
    );
  });
  it("persists safe definitions of either classification, recovers from storage failure ", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) || null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    expect(
      writeServers(storage, [
        server,
        { ...server, id: "ot-adult", classification: "adult" },
        {
          ...server,
          id: "ot-account",
          base: "https://server.test/movie/user/secret/",
        },
      ]),
    ).toBe(true);
    expect(readServers(storage)).toEqual([
      server,
      { ...server, id: "ot-adult", classification: "adult" },
    ]);
    expect(data.get(SERVERS_KEY)).not.toContain("secret");
    data.set(
      SERVERS_KEY,
      '{"version":1,"servers":[null,{},' + JSON.stringify(server) + "]}",
    );
    expect(readServers(storage)).toEqual([server]);
    expect(readServers({ getItem: () => "invalid" })).toEqual([]);
    expect(
      writeServers(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        [server],
      ),
    ).toBe(false);
  });
});
describe("linked server titles", () => {
  it("name the server on the stream and take a TMDB id from a numeric title id", () => {
    const linked = resolveServerMedia(
      item({
        type: "movie",
        serverId: server.id,
        providerItemId: "603",
        streams: [],
      }),
      [server],
    );
    expect(linked.streams[0].quality).toBe(server.name);
    expect(linked.tmdbId).toBe(603);
    const imdb = resolveServerMedia(
      item({
        type: "movie",
        serverId: server.id,
        providerItemId: "tt123",
        streams: [],
      }),
      [server],
    );
    expect(imdb.tmdbId).toBeUndefined();
  });
});
describe("embed protection", () => {
  it("keeps a click guard or sandbox choice and treats anything else as open", () => {
    const base = {
      id: "ot-a1",
      name: "A",
      base: "https://a.example",
      classification: "general",
      enabled: true,
    };
    expect(validateServer({ ...base, guard: "sandbox" })?.guard).toBe(
      "sandbox",
    );
    expect(validateServer({ ...base, guard: "click" })?.guard).toBe("click");
    expect(validateServer({ ...base, guard: "nope" })?.guard).toBeUndefined();
    expect(validateServer(base)?.guard).toBeUndefined();
  });
  it("carries the guard onto the streams a server serves", () => {
    const server = {
      id: "ot-a1",
      name: "A",
      base: "https://a.example",
      classification: "general" as const,
      enabled: true,
      guard: "click" as const,
    };
    const movie = libraryContent(
      { kind: "movie", tmdbId: 1, title: "T", genres: [] },
      [server],
    );
    expect(movie.streams[0].guard).toBe("click");
  });
});
describe("linked titles on other servers", () => {
  const mk = (
    id: string,
    base: string,
    extra: Partial<MediaServer> = {},
  ): MediaServer => ({
    id: `ot-${id}`,
    name: id,
    base,
    classification: "general",
    enabled: true,
    ...extra,
  });
  const linked = (providerItemId: string) =>
    item({
      id: "p1",
      type: "movie",
      providerItemId,
      serverId: "ot-a",
      providerId: "personal-media",
    });
  it("offers the linked server first, then every other connected general server", () => {
    const servers = [
      mk("a", "https://a.example"),
      mk("b", "https://b.example"),
      mk("c", "https://c.example", { enabled: false }),
      mk("d", "https://d.example", { classification: "adult" }),
    ];
    const out = resolveServerMedia(linked("27205"), servers);
    expect(out.streams.map((s) => s.url)).toEqual([
      "https://a.example/embed/movie/27205",
      "https://b.example/embed/movie/27205",
    ]);
  });
  it("keeps one server for titles that are not addressed by a TMDB number", () => {
    const servers = [
      mk("a", "https://a.example"),
      mk("b", "https://b.example"),
    ];
    expect(resolveServerMedia(linked("tt0123"), servers).streams).toHaveLength(
      1,
    );
  });
});
