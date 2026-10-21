import { describe, expect, it } from "vitest";
import { parseM3U } from "../src/providers/m3u";
import { deduplicate, stableId, type Source } from "../src/domain/content";
import { canView, classify, queryCatalog } from "../src/domain/privacy";
import {
  loadUserState,
  saveUserState,
  STORAGE_KEY,
} from "../src/persistence/user-state";
import { mediaUrl, sensitiveUrl, streamFormat } from "../src/domain/urls";
const source: Source = {
  id: "test",
  name: "Test",
  kind: "m3u",
  classification: "general",
  enabled: true,
  description: "",
  refreshHours: 24,
  url: "https://example.com/channels/list.m3u",
};
import { item } from "./fixtures";
describe("playlist import trust boundary", () => {
  it("keeps commas in titles and quoted attributes, skips directives, resolves URLs and deduplicates alternatives", () => {
    const entries = parseM3U(
      '#EXTM3U\r\n#EXTINF:-1 tvg-id="world" tvg-logo="https://img.test/a,b.png" group-title="News;Culture",News, around the world\r\n#EXTVLCOPT:http-referrer=https://ignored.test\r\n../world.m3u8\r\n#EXTINF:-1 tvg-id="world",Alternative\r\nhttps://example.com/hd.m3u8\r\n',
      source,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe("News, around the world");
    expect(entries[0].streams[0].url).toBe("https://example.com/world.m3u8");
    expect(entries[0].genres).toEqual(["News", "Culture"]);
    expect(deduplicate(entries)[0].streams).toHaveLength(2);
  });
  it("rejects executable URLs and HTML disguised as a playlist", () => {
    expect(
      parseM3U("#EXTM3U\n#EXTINF:-1,Unsafe\njavascript:alert(1)", source),
    ).toEqual([]);
    expect(() => parseM3U("<html>denied</html>", source)).toThrow(/M3U/);
  });
  it("classifies explicit entries even when source is declared general; user playlists default to unknown", () => {
    const entries = parseM3U(
      '#EXTM3U\n#EXTINF:-1 group-title="18+",Late night\nhttps://example.com/a.m3u8',
      source,
    );
    expect(entries[0].classification).toBe("adult");
    expect(classify("Adult Swim", "general")).toBe("general");
    expect(classify("Unreviewed", "unknown")).toBe("unknown");
  });
});
describe("privacy queries apply to every consumer", () => {
  it("hides unknown and adult content before matching searches and filters", () => {
    const items = [
      item(),
      item({ id: "adult", classification: "adult", title: "Private" }),
      item({ id: "unknown", classification: "unknown", title: "Private" }),
    ];
    expect(queryCatalog(items)).toHaveLength(1);
    expect(queryCatalog(items, { text: "private" })).toHaveLength(0);
    expect(
      queryCatalog(items, { text: "private", adultUnlocked: true }),
    ).toHaveLength(2);
    expect(canView(items[1])).toBe(false);
  });
});
describe("non-destructive storage migration", () => {
  it("migrates favorites/progress to stable IDs, strips only old now-playing URLs, preserves forms and originals", () => {
    const publicUrl = "https://example.com/film.mp4",
      secret = "https://provider.test/movie/user/password/1.mp4";
    const map = new Map<string, string>([
      ["opentv_favs", JSON.stringify([publicUrl, secret])],
      ["ot_resume", JSON.stringify({ [publicUrl]: 123, [secret]: 40 })],
      [
        "ot_session",
        JSON.stringify({
          v: 1,
          tab: "srv",
          form: { title: "draft" },
          now: { url: secret },
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => map.get(key) || null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
    const state = loadUserState(storage);
    expect(state.favorites).toEqual([stableId(publicUrl)]);
    expect(state.progress[stableId(publicUrl)]).toBe(123);
    expect(state.session.route).toBe("library");
    expect(map.get(STORAGE_KEY)).not.toContain("password");
    expect(JSON.parse(map.get("ot_session")!).form.title).toBe("draft");
    expect(JSON.parse(map.get("ot_session")!).now).toBe(null);
    expect(map.get("opentv_favs")).toContain(publicUrl);
    expect(loadUserState(storage)).toEqual(state);
  });
  it("recovers from malformed JSON, invalid shapes, nonfinite numbers and quota errors", () => {
    const storage = {
      getItem: () => "{broken",
      setItem: () => {
        throw new Error("quota");
      },
    };
    const state = loadUserState(storage);
    expect(state.favorites).toEqual([]);
    expect(saveUserState(storage, state)).toBe(false);
    const invalid = {
      getItem: () =>
        JSON.stringify({
          version: 2,
          favorites: {},
          progress: { "ot-ab": -3 },
          session: { route: "unsafe" },
          preferences: { volume: 99 },
        }),
      setItem: () => {},
    };
    const recovered = loadUserState(invalid);
    expect(recovered.session.route).toBe("home");
    expect(recovered.preferences.volume).toBe(1);
    expect(recovered.progress).toEqual({});
  });
});
describe("URL handling", () => {
  it("detects original HLS regardless of query, rejects dangerous schemes and identifies account URLs", () => {
    expect(streamFormat("https://example.com/live.m3u8?token=abc")).toBe("hls");
    expect(mediaUrl("data:text/html,test")).toBe(null);
    expect(mediaUrl("https://user:pass@example.com/")).toBe(null);
    expect(sensitiveUrl("https://example.com/live/user/password/1.m3u8")).toBe(
      true,
    );
    expect(sensitiveUrl("https://example.com/file.mp4?token=abc")).toBe(true);
    expect(sensitiveUrl("https://example.com/file.mp4")).toBe(false);
  });
});

describe("catalog validation", () => {
  it("projects allowed fields and rejects invalid aliases without retaining arbitrary secrets", async () => {
    const { validateContent } = await import("../src/providers/catalog");
    const values = validateContent([
      { ...item(), password: "secret", aliases: { unexpected: "shape" } },
      null,
      { title: "broken" },
    ]);
    expect(values).toHaveLength(1);
    expect(values[0].aliases).toEqual([]);
    expect(JSON.stringify(values)).not.toContain("secret");
  });
  it("retains opaque aliases when exact URLs merge, and keeps regional names distinct", () => {
    const merged = deduplicate([
      item(),
      item({ id: stableId("same-url"), providerId: "other" }),
      item({
        id: stableId("different-region"),
        streams: [{ url: "https://example.com/region.m3u8", format: "hls" }],
      }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].aliases).toContain(stableId("same-url"));
  });
});

describe("extended session and personal library safety", () => {
  it("reads v2 data without new fields and projects safe drafts, views and collections", () => {
    const value = {
      version: 2,
      favorites: [],
      collections: [
        {
          id: "ot-valid",
          name: "Sunday cinema",
          itemIds: ["ot-film", "unsafe"],
        },
        { id: "ot-hidden", name: "18+ archive", itemIds: [] },
      ],
      session: {
        route: "live",
        genre: "News",
        views: {
          live: {
            genre: "News",
            language: "English",
            country: "United Kingdom",
            limit: 216,
            guide: true,
          },
        },
        library: { tab: "personal", limit: 144 },
        drafts: {
          media: {
            title: "Draft film",
            description: "Saved notes",
            type: "movie",
            classification: "general",
            url: "https://example.com/secret.mp4?token=secret",
          },
          playlist: {
            name: "My channels",
            classification: "general",
            url: "https://example.com/list?password=secret",
          },
        },
      },
    };
    const state = loadUserState({
      getItem: () => JSON.stringify(value),
      setItem: () => {},
    });
    // A name the classifier flags is still yours: nothing is dropped by name.
    expect(state.collections).toEqual([
      { id: "ot-valid", name: "Sunday cinema", itemIds: ["ot-film"] },
      { id: "ot-hidden", name: "18+ archive", itemIds: [] },
    ]);
    expect(state.session.views.live?.limit).toBe(216);
    expect(state.session.library.tab).toBe("personal");
    expect(state.session.drafts.media?.title).toBe("Draft film");
    expect(JSON.stringify(state)).not.toContain("secret");
  });
  it("replaces edited media under the existing ID and excludes sensitive artwork as well as streams", async () => {
    const { upsertMedia, canPersistContent } =
      await import("../src/domain/library");
    const original = item({ providerId: "personal-media" });
    const updated = {
      ...original,
      title: "Updated",
      streams: [
        { url: "https://example.com/new.mp4", format: "video" as const },
      ],
    };
    expect(upsertMedia([original], [updated])).toEqual([updated]);
    expect(
      canPersistContent({
        ...original,
        backdrop: "https://example.com/poster.jpg?token=secret",
      }),
    ).toBe(false);
    expect(canPersistContent({ ...original, classification: "adult" })).toBe(
      true,
    );
    expect(canPersistContent(original)).toBe(true);
  });
});
