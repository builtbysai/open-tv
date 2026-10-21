import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import { stableId, type Content } from "../src/domain/content";
import { recommend } from "../src/domain/recommendations";
const title = (name: string, patch: Partial<Content> = {}) =>
  item({ id: stableId(name), title: name, ...patch });
describe("local general recommendations", () => {
  it("uses favorite aliases and general history without resurfacing seen titles", () => {
    const seed = title("Seed", { aliases: ["ot-oldseed"] }),
      unseen = title("Related"),
      other = title("Unrelated", { genres: ["Sport"], countries: ["US"] });
    const result = recommend([seed, unseen, other], {
      favorites: ["ot-oldseed"],
      history: [],
    });
    expect(result).toEqual([unseen]);
    expect(
      recommend([seed, unseen], { favorites: [], history: [{ id: seed.id }] }),
    ).toEqual([unseen]);
  });
  it("excludes private/unknown/blocked activity and results at the query layer", () => {
    const seed = title("Seed"),
      good = title("Related"),
      restricted = title("Restricted", { classification: "adult" }),
      unknown = title("Unknown", { classification: "unknown" });
    const items = [seed, good, restricted, unknown];
    expect(
      recommend(items, { favorites: [restricted.id, unknown.id], history: [] }),
    ).toEqual([]);
    expect(recommend(items, { favorites: [seed.id], history: [] })).toEqual([
      good,
    ]);
    expect(
      recommend(items, {
        favorites: [seed.id],
        history: [],
        policy: {
          blockedContentIds: [good.id],
          blockedProviderIds: [],
          blockedStreamIds: [],
        },
      }),
    ).toEqual([]);
  });
  it("does not suggest unavailable, external, exhausted or duplicate-alias items", () => {
    const seed = title("Seed"),
      good = title("Related"),
      alias = title("Duplicate", { aliases: [good.id] });
    const items = [
      seed,
      good,
      alias,
      title("External", { availability: "external" }),
      title("Unavailable", { availability: "unavailable" }),
      title("Empty", { streams: [] }),
      title("Episode", { type: "episode" }),
    ];
    const result = recommend(items, { favorites: [seed.id], history: [] });
    expect(result).toHaveLength(1);
    expect([good.id, alias.id]).toContain(result[0].id);
    expect(recommend(items, { favorites: [], history: [] })).toEqual([]);
    expect(
      recommend(items, { favorites: [seed.id], history: [], limit: 0 }),
    ).toEqual([]);
  });
});
