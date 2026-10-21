import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken } from "../src/transfer/crypto";
import { Assembler, parseChunk, splitMessage } from "../src/transfer/relay";
import { bundleIsEmpty, parseBundle } from "../src/transfer/bundle";
describe("encrypted transfer", () => {
  it("round-trips data and rejects the wrong key or tampering", async () => {
    const key = randomToken(32);
    const sealed = await encrypt(key, { hello: "tv", n: [1, 2] });
    expect(sealed).not.toContain("hello");
    expect(await decrypt(key, sealed)).toEqual({ hello: "tv", n: [1, 2] });
    await expect(decrypt(randomToken(32), sealed)).rejects.toThrow();
    const bytes =
      sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decrypt(key, bytes)).rejects.toThrow();
  });
  it("splits large payloads into relay-sized chunks and reassembles out of order", () => {
    const payload = "a".repeat(7000) + "b".repeat(100);
    const messages = splitMessage("abcd1234", payload);
    expect(messages.length).toBe(3);
    expect(Math.max(...messages.map((m) => m.length))).toBeLessThan(4000);
    const assembler = new Assembler();
    let done: { id: string; payload: string } | null = null;
    for (const message of [messages[2], messages[0], messages[1]]) {
      const chunk = parseChunk(message)!;
      done = assembler.add(chunk) ?? done;
    }
    expect(done).toEqual({ id: "abcd1234", payload });
  });
  it("ignores chunks that are not part of the protocol", () => {
    expect(parseChunk("hello")).toBeNull();
    expect(parseChunk("OTV1.abcd.5.2.xxx")).toBeNull();
    expect(parseChunk("OTV1.abcd.0.999.xxx")).toBeNull();
    expect(parseChunk("OTV1.abcd.0.1.<script>")).toBeNull();
  });
});
describe("phone bundles", () => {
  const exp = Date.now() + 60000;
  it("keeps only valid playlists, servers, keys and account details", () => {
    const bundle = parseBundle({
      v: 1,
      exp,
      playlists: [
        {
          name: "Mine",
          url: "https://example.com/list.m3u",
          kind: "m3u",
          classification: "general",
        },
        {
          name: "Login",
          url: "https://user:pw@example.com/list.m3u",
          kind: "m3u",
        },
        { name: "Bad", url: "javascript:alert(1)", kind: "m3u" },
      ],
      servers: [{ nope: true }],
      tmdbKey: "abcdef0123456789abcdef0123456789",
      account: {
        server: "https://provider.example",
        username: "u",
        password: "p",
        mode: "series",
      },
    });
    expect(bundle.playlists.map((p) => p.name)).toEqual(["Mine"]);
    expect(bundle.playlists[0]).toMatchObject({
      classification: "general",
      enabled: true,
    });
    expect(bundle.servers).toEqual([]);
    expect(bundle.tmdbKey).toBeDefined();
    expect(bundle.account?.mode).toBe("series");
  });
  it("defaults unknown classifications to general and drops bad keys", () => {
    const bundle = parseBundle({
      v: 1,
      exp,
      playlists: [
        {
          url: "https://example.com/a.m3u",
          kind: "m3u",
          classification: "whatever",
        },
      ],
      tmdbKey: "short",
      account: { server: "https://p.example", username: "", password: "x" },
    });
    expect(bundle.playlists[0].classification).toBe("general");
    expect(bundle.tmdbKey).toBeUndefined();
    expect(bundle.account).toBeUndefined();
  });
  it("rejects expired or malformed bundles", () => {
    expect(() => parseBundle({ v: 1, exp: Date.now() - 1 })).toThrow();
    expect(() => parseBundle({ v: 2, exp })).toThrow();
    expect(() => parseBundle(null)).toThrow();
  });
});

describe("connected sources in a bundle", () => {
  it("keeps valid source ids and drops anything else", () => {
    const bundle = parseBundle({
      v: 1,
      exp: Date.now() + 60000,
      playlists: [],
      servers: [],
      connect: ["open-cinema", "world-live-1", "Bad Id", 7, "x".repeat(70)],
    });
    expect(bundle.connect).toEqual(["open-cinema", "world-live-1"]);
    expect(bundleIsEmpty(bundle)).toBe(false);
  });
});
