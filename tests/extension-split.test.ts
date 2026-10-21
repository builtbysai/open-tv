import { describe, expect, it } from "vitest";
import { parseExtension } from "../src/extension/format";
import { bundleExtension, splitExtension } from "../src/extension/split";

const item = (n: number, country: string) => ({
  id: `ot-${n}`,
  title: `Channel ${n} ${"x".repeat(200)}`,
  countries: [country],
});
const source = {
  id: "world",
  name: "World",
  kind: "catalog",
  items: [
    ...Array.from({ length: 700 }, (_, i) => item(i, "Aland")),
    ...Array.from({ length: 600 }, (_, i) => item(1000 + i, "Brazil")),
    ...Array.from({ length: 50 }, (_, i) => item(2000 + i, "Chile")),
  ],
};
const playlist = (n: number) =>
  `#EXTM3U\n${Array.from({ length: n }, (_, i) => `#EXTINF:-1,Ch ${i}\nhttps://a.example/${i}.m3u8`).join("\n")}`;
const input = {
  format: "open-tv-extension",
  version: 1,
  name: "Pack",
  sources: [
    source,
    { id: "big", name: "Big list", kind: "m3u", m3u: playlist(6000) },
    { id: "small", name: "Small", kind: "m3u", m3u: playlist(3) },
  ],
};

describe("splitExtension", () => {
  const { index, files } = splitExtension(input, {
    minBytes: 50_000,
    maxItems: 800,
  });
  it("moves big sources to data files and leaves small ones inline", () => {
    const sources = index.sources as {
      id: string;
      url?: string;
      m3u?: string;
    }[];
    expect(sources.map((s) => s.id)).toEqual([
      "world-1",
      "world-2",
      "big",
      "small",
    ]);
    expect(sources[0].url).toBe("extension-data/world-1.json");
    expect(sources[2].url).toBe("extension-data/big.m3u");
    expect(sources[3].m3u).toContain("#EXTM3U");
    expect(files.map((f) => f.path)).toEqual([
      "extension-data/world-1.json",
      "extension-data/world-2.json",
      "extension-data/big.m3u",
    ]);
  });
  it("keeps whole countries together and names each file", () => {
    const names = (index.sources as { name: string }[])
      .slice(0, 2)
      .map((s) => s.name);
    expect(names[0]).toBe("World · Aland, Chile");
    expect(names[1]).toBe("World · Brazil");
    const total = files
      .filter((f) => f.path.endsWith(".json"))
      .reduce((n, f) => n + JSON.parse(f.content).items.length, 0);
    expect(total).toBe(1350);
  });
  it("bundles back to the same lists", () => {
    const store = new Map(files.map((f) => [f.path, f.content]));
    const back = bundleExtension(index, (p) => store.get(p) ?? "");
    const sources = back.sources as {
      items?: unknown[];
      m3u?: string;
      url?: string;
    }[];
    expect(sources.every((s) => s.url === undefined)).toBe(true);
    expect(sources[0].items).toHaveLength(750);
    expect(sources[2].m3u).toBe(playlist(6000));
  });
});

describe("relative data files", () => {
  const index = {
    format: "open-tv-extension",
    version: 1,
    sources: [
      { id: "a", name: "A", kind: "m3u", url: "extension-data/a.m3u" },
      { id: "b", name: "B", kind: "m3u", url: "../escape.m3u" },
      { id: "c", name: "C", kind: "m3u", url: "https://x.example/c.m3u" },
    ],
  };
  it("resolves against where the extension was loaded from", () => {
    const file = parseExtension(
      index,
      "https://site.example/app/extension.json",
    );
    expect(file.sources.map((s) => s.url)).toEqual([
      "https://site.example/app/extension-data/a.m3u",
      "https://x.example/c.m3u",
    ]);
  });
  it("leaves them out of a file loaded without an address, and says so", () => {
    const file = parseExtension(index);
    expect(file.sources.map((s) => s.id)).toEqual(["c"]);
    expect(file.unresolved).toBe(1);
    expect(() =>
      parseExtension({ ...index, sources: [index.sources[0]] }),
    ).toThrow(/next to it/);
  });
});
