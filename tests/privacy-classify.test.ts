import { describe, expect, it } from "vitest";
import { canView, classify, queryCatalog } from "../src/domain/privacy";
import type { Content } from "../src/domain/content";

describe("the 18+ classifier only flags", () => {
  it("keeps everyday names general", () => {
    for (const name of [
      "Comic Strip Theater",
      "Adult Contemporary Hits",
      "Adult Swim",
      "Adult education channel",
    ])
      expect(classify(name)).toBe("general");
  });
  it("flags explicit names", () => {
    for (const name of ["XXX Night", "Erotica 24", "Striptease live", "18+ TV"])
      expect(classify(name)).toBe("adult");
  });
  it("adds 18+ titles to a query without taking any away", () => {
    const item = (id: string, classification: Content["classification"]) =>
      ({
        id,
        title: `News ${id}`,
        genres: [],
        languages: [],
        countries: [],
        classification,
      }) as unknown as Content;
    const items = [item("a", "general"), item("b", "adult")];
    const locked = queryCatalog(items, { text: "news" });
    const unlocked = queryCatalog(items, { text: "news", adultUnlocked: true });
    expect(locked.map((c) => c.id)).toEqual(["a"]);
    expect(unlocked.map((c) => c.id)).toEqual(["a", "b"]);
    expect(canView(items[1])).toBe(false);
  });
});

describe("the device PIN", () => {
  it("guards every profile on the device, and removing it removes it for all", async () => {
    const { loadUserState, saveUserState } =
      await import("../src/persistence/user-state");
    const data = new Map<string, string>();
    const device = (profile: string) => ({
      getItem: (key: string) =>
        data.get(key === "opentv:user:v2" ? `${profile}:${key}` : key) ?? null,
      setItem: (key: string, value: string) =>
        data.set(key === "opentv:user:v2" ? `${profile}:${key}` : key, value),
    });
    const main = loadUserState(device("main"));
    main.preferences.pinHash = "a".repeat(64);
    main.preferences.pinSalt = "b".repeat(32);
    saveUserState(device("main"), main);
    const kid = loadUserState(device("kid"));
    expect(kid.preferences.pinHash).toBe("a".repeat(64));
    delete kid.preferences.pinHash;
    delete kid.preferences.pinSalt;
    saveUserState(device("kid"), kid);
    expect(loadUserState(device("main")).preferences.pinHash).toBeUndefined();
  });
  it("moves data from before profiles into the first profile only", async () => {
    const { loadUserState } = await import("../src/persistence/user-state");
    const data = new Map<string, string>([
      ["opentv_favs", JSON.stringify(["https://example.com/a.m3u8"])],
    ]);
    const device = (profile: string) => ({
      getItem: (key: string) =>
        data.get(key === "opentv:user:v2" ? `${profile}:${key}` : key) ?? null,
      setItem: (key: string, value: string) =>
        data.set(key === "opentv:user:v2" ? `${profile}:${key}` : key, value),
    });
    expect(loadUserState(device("main")).favorites).toHaveLength(1);
    expect(loadUserState(device("kid")).favorites).toHaveLength(0);
  });
  it("keeps saved titles found on your servers across a reload", async () => {
    const { loadUserState } = await import("../src/persistence/user-state");
    const saved = {
      version: 2,
      favorites: ["embed:movie:603", "embed:series:1399:s1e2", "bad id"],
      history: [{ id: "embed:movie:603", at: 1 }],
      progress: { "embed:movie:603": 120 },
      collections: [
        { id: "ot-c1", name: "Mine", itemIds: ["embed:movie:603"] },
      ],
    };
    const state = loadUserState({
      getItem: (key) =>
        key === "opentv:user:v2" ? JSON.stringify(saved) : null,
      setItem: () => {},
    });
    expect(state.favorites).toEqual([
      "embed:movie:603",
      "embed:series:1399:s1e2",
    ]);
    expect(state.history).toHaveLength(1);
    expect(state.progress["embed:movie:603"]).toBe(120);
    expect(state.collections[0].itemIds).toEqual(["embed:movie:603"]);
  });
});
