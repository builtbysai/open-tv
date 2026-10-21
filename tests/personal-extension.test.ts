import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExtension, type ExtensionFile } from "../src/extension/format";
import {
  describeImport,
  newData,
  rememberApplied,
  sameServer,
  summarize,
  type DataMode,
} from "../src/extension/data";
import type { MediaServer } from "../src/domain/servers";
import { validTmdbKey } from "../src/persistence/tmdb-key";
import { keysIn, scanForKeys } from "../scripts/check-keys";

const TEST_KEY = "0123456789abcdef0123456789abcdef";
const personal = (key = TEST_KEY) =>
  parseExtension({
    format: "open-tv-extension",
    version: 1,
    name: "Personal",
    tmdbKey: key,
    servers: [
      { name: "Home", base: "https://home.example", enabled: true },
      { name: "Cabin", base: "https://cabin.example/", guard: "click" },
    ],
  });
// A device as the app wires it: servers matched by address or name, key set on import, and
// every entry remembered as applied.
function device() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const state = { servers: [] as MediaServer[], key: "" };
  const apply = (file: ExtensionFile, mode: DataMode) => {
    const data = newData(file, mode, storage, {
      music: () => false,
      server: (s) =>
        state.servers.some((x) => x.id === s.id || sameServer(x, s)),
    });
    state.servers.push(...data.servers);
    if (data.tmdbKey) state.key = data.tmdbKey;
    rememberApplied(storage, file);
    return describeImport(0, summarize(data));
  };
  return { state, apply };
}

describe("personal extension", () => {
  it("applies the key and both servers once, and says so", () => {
    const { state, apply } = device();
    expect(apply(personal(), "import")).toBe("Added 2 servers, your TMDB key.");
    expect(state.key).toBe(TEST_KEY);
    expect(state.servers.map((s) => s.name)).toEqual(["Home", "Cabin"]);
    expect(state.servers[0]).toMatchObject({ enabled: true });
    expect(state.servers[1]).toMatchObject({ enabled: false, guard: "click" });
  });
  it("adds no duplicates on a second import", () => {
    const { state, apply } = device();
    apply(personal(), "import");
    expect(apply(personal(), "import")).toBe(
      "Added your TMDB key. 2 already on this device.",
    );
    expect(state.servers).toHaveLength(2);
  });
  it("matches an existing server by address or by name", () => {
    const { state, apply } = device();
    state.servers.push(
      { ...personal().servers[0], id: "ot-mine", name: "home" },
      {
        ...personal().servers[1],
        id: "ot-other",
        base: "https://CABIN.example",
      },
    );
    apply(personal(), "import");
    expect(state.servers).toHaveLength(2);
  });
  it("never applies a key from an auto-loaded pack", () => {
    const { state, apply } = device();
    expect(apply(personal(), "start")).toBe("Added 2 servers.");
    expect(state.key).toBe("");
  });
  it("does not bring back a server the person removed when the pack reloads", () => {
    const { state, apply } = device();
    apply(personal(), "start");
    state.servers = state.servers.filter((s) => s.name !== "Home");
    apply(personal(), "start");
    expect(state.servers.map((s) => s.name)).toEqual(["Cabin"]);
    // Importing it on purpose adds it back, once.
    apply(personal(), "import");
    apply(personal(), "import");
    expect(state.servers.map((s) => s.name).sort()).toEqual(["Cabin", "Home"]);
  });
  it("ships a template that validates but carries no usable key", () => {
    const template = parseExtension(
      readFileSync(
        new URL("../personal-extension.example.json", import.meta.url),
        "utf8",
      ),
    );
    expect(template.servers).toHaveLength(2);
    expect(template.tmdbKey).toBeUndefined();
    const { state, apply } = device();
    expect(apply(template, "import")).toBe("Added 2 servers.");
    expect(state.key).toBe("");
  });
  it("refuses placeholder keys and accepts real ones", () => {
    for (const fake of [
      "YOUR_TMDB_API_KEY",
      "your-tmdb-key-here",
      "PLACEHOLDER_KEY_123",
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "short",
    ])
      expect(validTmdbKey(fake)).toBeUndefined();
    expect(validTmdbKey(TEST_KEY)).toBe(TEST_KEY);
    expect(validTmdbKey("eyJhbGciOiJIUzI1NiJ9.eyJ5b3VyIjoidG1kYiJ9.sig")).toBe(
      "eyJhbGciOiJIUzI1NiJ9.eyJ5b3VyIjoidG1kYiJ9.sig",
    );
  });
});

describe("shipped files", () => {
  it("tells a key from a stream id in an address", () => {
    expect(keysIn(`{"tmdbKey":"${TEST_KEY}"}`)).toHaveLength(1);
    expect(
      keysIn(`https://x.example/3/movie?api_key=${TEST_KEY}`),
    ).toHaveLength(1);
    expect(keysIn(`https://cdn.example/out/${TEST_KEY}/index.m3u8`)).toEqual(
      [],
    );
  });
  it("hold nothing that looks like a TMDB key", async () => {
    const root = new URL("../", import.meta.url).pathname;
    for (const dir of ["public", "dist", "dist-site"])
      expect(await scanForKeys(root + dir)).toEqual([]);
  });
});
