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
