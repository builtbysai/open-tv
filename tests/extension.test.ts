import { afterEach, describe, expect, it } from "vitest";
import { parseExtension, toSource } from "../src/extension/format";
import { checkExtensionUrl } from "../src/extension/store";
import {
  describeImport,
  newData,
  rememberApplied,
} from "../src/extension/data";
import { loadSource } from "../src/providers/catalog";
import {
  clearDeviceExtension,
  saveDeviceExtension,
} from "../src/extension/store";

const file = (sources: unknown[]) => ({
  format: "open-tv-extension",
  version: 1,
  name: "Test",
  sources,
});
const playlist =
  '#EXTM3U\n#EXTINF:-1 tvg-language="English" group-title="News",One\nhttps://example.com/one.m3u8';

describe("parseExtension", () => {
  it("accepts url, playlist text and catalog sources and applies defaults", () => {
    const out = parseExtension(
      file([
        {
          id: "a-list",
          name: "A",
          kind: "m3u",
          url: "https://x.example/a.m3u",
        },
        { id: "b-list", name: "B", kind: "m3u", m3u: playlist },
        { id: "c-cat", name: "C", kind: "catalog", items: [] },
      ]),
    );
    expect(out.sources.map((s) => s.id)).toEqual(["a-list", "b-list", "c-cat"]);
    expect(out.sources[0]).toMatchObject({
      classification: "general",
      enabled: false,
      refreshHours: 24,
      priority: 0,
    });
  });
  it("keeps 18+ sources marked as 18+", () => {
    const out = parseExtension(
      file([
        {
          id: "x",
          name: "X",
          kind: "m3u",
          classification: "adult",
          m3u: playlist,
        },
      ]),
    );
    expect(out.sources[0].classification).toBe("adult");
  });
  it("leaves out sources it cannot use and says why when none are left", () => {
    const out = parseExtension(
      file([
        { id: "ok", name: "OK", kind: "m3u", url: "https://x.example/a.m3u" },
        {
          id: "Bad Id",
          name: "Bad",
          kind: "m3u",
          url: "https://x.example/a.m3u",
        },
        {
          id: "http",
          name: "Http",
          kind: "m3u",
          url: "http://x.example/a.m3u",
        },
        {
          id: "two",
          name: "Two",
          kind: "m3u",
          url: "https://x.example/a.m3u",
          m3u: playlist,
        },
        { id: "none", name: "None", kind: "m3u" },
        { id: "mix", name: "Mix", kind: "catalog", m3u: playlist },
        {
          id: "ok",
          name: "Again",
          kind: "m3u",
          url: "https://x.example/b.m3u",
        },
      ]),
    );
    expect(out.sources.map((s) => s.id)).toEqual(["ok"]);
    expect(() => parseExtension(file([{ id: "bad id" }]))).toThrow(
      /nothing usable/,
    );
  });
  it("refuses files that are not extensions", () => {
    expect(() => parseExtension("not json")).toThrow(/not valid JSON/);
    expect(() => parseExtension({ format: "other" })).toThrow(
      /not an Open TV extension/,
    );
    expect(() =>
      parseExtension({ format: "open-tv-extension", version: 2, sources: [] }),
    ).toThrow(/different version/);
  });
  it("describes sources without carrying their data", () => {
    const [s] = parseExtension(
      file([{ id: "b", name: "B", kind: "m3u", m3u: playlist }]),
    ).sources;
    expect(toSource(s)).toMatchObject({ extension: true, inline: true });
    expect(toSource(s)).not.toHaveProperty("m3u");
  });
});

describe("loading an inline source", () => {
  afterEach(() => clearDeviceExtension());
  it("reads playlist text from the extension saved on the device", async () => {
    const parsed = parseExtension(
      file([{ id: "inline-list", name: "Inline", kind: "m3u", m3u: playlist }]),
    );
    await saveDeviceExtension(parsed);
    const { items } = await loadSource(toSource(parsed.sources[0]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "One", providerId: "inline-list" });
  });
  it("says to import again when the extension is gone", async () => {
    const parsed = parseExtension(
      file([{ id: "gone", name: "Gone", kind: "m3u", m3u: playlist }]),
    );
    await clearDeviceExtension();
    await expect(loadSource(toSource(parsed.sources[0]))).rejects.toThrow(
      /Import the extension again/,
    );
  });
});

describe("checkExtensionUrl", () => {
  it("accepts plain https addresses and refuses anything else", () => {
    expect(checkExtensionUrl(" https://example.com/e.json?t=1 ")).toBe(
      "https://example.com/e.json?t=1",
    );
    expect(() => checkExtensionUrl("http://example.com/e.json")).toThrow();
    expect(() => checkExtensionUrl("https://user:pw@example.com/")).toThrow();
    expect(() => checkExtensionUrl("not a url")).toThrow();
  });
});

describe("extension settings", () => {
  const base = {
    format: "open-tv-extension",
    version: 1,
    name: "Settings only",
  };
  it("accepts a file with settings and no sources", () => {
    const file = parseExtension({
      ...base,
      musicProviders: [
        { name: "Mine", type: "invidious", base: "https://inv.example/" },
        { name: "Bad", type: "other", base: "https://x.example" },
        { name: "Dup", type: "invidious", base: "https://inv.example" },
      ],
      servers: [{ name: "Srv", base: "https://srv.example", guard: "click" }],
      tmdbKey: "abcdefghijklmnop1234",
    });
    expect(file.sources).toEqual([]);
    expect(file.musicProviders).toHaveLength(1);
    expect(file.musicProviders[0]).toMatchObject({
      name: "Mine",
      base: "https://inv.example",
    });
    expect(file.servers[0]).toMatchObject({ guard: "click", enabled: false });
    expect(file.tmdbKey).toBe("abcdefghijklmnop1234");
  });
  it("still refuses a file with nothing usable", () => {
    expect(() => parseExtension({ ...base, sources: [] })).toThrow();
  });
  it("applies key and profile only to an import, and adds each entry once", () => {
    const file = parseExtension({
      ...base,
      musicProviders: [
        { name: "Mine", type: "piped", base: "https://piped.example" },
      ],
      tmdbKey: "abcdefghijklmnop1234",
      profile: { version: 1 },
    });
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const none = { music: () => false, server: () => false };
    const start = newData(file, "start", storage, none);
    expect(start.musicProviders).toHaveLength(1);
    expect(start.tmdbKey).toBeUndefined();
    expect(start.profile).toBeUndefined();
    rememberApplied(storage, file);
    // Removed by the person: a later start does not put it back, an import does.
    expect(newData(file, "start", storage, none).musicProviders).toHaveLength(
      0,
    );
    const again = newData(file, "import", storage, none);
    expect(again.musicProviders).toHaveLength(1);
    expect(again.tmdbKey).toBe("abcdefghijklmnop1234");
    expect(
      newData(file, "import", storage, { ...none, music: () => true })
        .musicProviders,
    ).toHaveLength(0);
  });
});

describe("extension guides and notices", () => {
  const base = { format: "open-tv-extension", version: 1, name: "G" };
  it("keeps https guides, drops others, and accepts an Audius provider", () => {
    const file = parseExtension({
      ...base,
      guides: [
        { name: "Good", url: "https://guide.example/a.xml" },
        { name: "Plain", url: "http://guide.example/a.xml" },
        { name: "Dup", url: "https://guide.example/a.xml" },
        { name: "", url: "https://guide.example/b.xml" },
      ],
      musicProviders: [
        { name: "Audius", type: "audius", base: "https://api.audius.co" },
      ],
    });
    expect(file.guides).toEqual([
      { name: "Good", url: "https://guide.example/a.xml" },
    ]);
    expect(file.musicProviders[0]).toMatchObject({ type: "audius" });
  });
  it("says what was already on the device", () => {
    expect(
      describeImport(0, {
        musicProviders: 0,
        servers: 0,
        tmdbKey: false,
        profile: false,
        already: 4,
      }),
    ).toBe("Nothing new in this file. 4 already on this device.");
  });
});
