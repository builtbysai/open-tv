import { describe, expect, it } from "vitest";
import { merge, missingFrom, parseDoc, prune, put, remove, TOMBSTONE_MS } from "../src/core/lww";
import { parseRef, refKey } from "../src/core/module";

describe("last-writer-wins", () => {
  it("keeps the newer value and converges in either order", () => {
    const a = put({}, "pref:lang", "en", 10);
    const b = put({}, "pref:lang", "fr", 20);
    expect(merge(a, b).doc["pref:lang"][1]).toBe("fr");
    expect(merge(b, a).doc["pref:lang"][1]).toBe("fr");
    expect(merge(a, b).changed).toEqual(["pref:lang"]);
    expect(merge(b, a).changed).toEqual([]);
  });
  it("settles a tie the same way on both sides", () => {
    const a = put({}, "pref:x", "a", 5);
    const b = put({}, "pref:x", "b", 5);
    expect(merge(a, b).doc).toEqual(merge(b, a).doc);
  });
  it("a removal beats an older value and is not undone by it", () => {
    const withItem = put({}, "list:movies:tv:1", { t: 1 }, 10);
    const removed = remove(withItem, "list:movies:tv:1", 20);
    expect(merge(withItem, removed).doc["list:movies:tv:1"][1]).toBeNull();
    expect(merge(removed, withItem).doc["list:movies:tv:1"][1]).toBeNull();
  });
  it("answers a full document with only what the sender lacks", () => {
    const mine = put(put({}, "pref:a", 1, 10), "pref:b", 2, 10);
    const theirs = put({}, "pref:a", 1, 10);
    expect(Object.keys(missingFrom(mine, theirs))).toEqual(["pref:b"]);
    expect(missingFrom(mine, mine)).toEqual({});
  });
  it("drops old tombstones, keeps live entries", () => {
    const now = TOMBSTONE_MS * 3;
    const doc = { "list:a:b:c": [1, null], "pref:keep": [1, "x"], "list:d:e:f": [now - 5, null] } as never;
    expect(Object.keys(prune(doc, now)).sort()).toEqual(["list:d:e:f", "pref:keep"]);
  });
  it("validates a document from outside", () => {
    expect(parseDoc({ "pref:a": [1, "x"] })).toEqual({ "pref:a": [1, "x"] });
    for (const bad of [null, [], { "bad key": [1, 1] }, { "pref:a": [1] }, { "pref:a": ["1", 1] }, { "pref:a": [-1, 1] }])
      expect(parseDoc(bad)).toBeNull();
  });
});

describe("media references", () => {
  it("accepts a plain ref and bounds what it keeps", () => {
    const ref = parseRef({ mod: "movies", kind: "movie", id: "603", title: "The Matrix", year: 1999, poster: "https://image.tmdb.org/p.jpg", rating: 8.2, extra: "dropped" });
    expect(ref).toEqual({ mod: "movies", kind: "movie", id: "603", title: "The Matrix", year: 1999, poster: "https://image.tmdb.org/p.jpg", rating: 8.2 });
  });
  it("rejects bad modules, kinds and urls", () => {
    expect(parseRef({ mod: "Bad Mod", kind: "movie", id: "1", title: "x" })).toBeNull();
    expect(parseRef({ mod: "m", kind: "movie", id: "", title: "x" })).toBeNull();
    expect(parseRef({ mod: "m", kind: "movie", id: "1", title: "x", poster: "javascript:alert(1)" })).not.toHaveProperty("poster");
  });
  it("keys an episode by its show", () => {
    expect(refKey({ mod: "movies", kind: "episode", id: "1396" })).toBe("movies:tv:1396");
  });
});
