import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import { similarTo } from "../src/domain/similar";
import type { Content } from "../src/domain/content";
const film = (id: string, genres: string[], patch: Partial<Content> = {}) =>
  item({ id, title: id, type: "movie", genres, countries: ["US"], ...patch });
describe("similar titles", () => {
  const seed = film("seed", ["Sci-Fi", "Drama"], { year: 2010 });
  it("ranks by genre overlap and era, excluding the seed, channels and other kinds", () => {
    const result = similarTo(seed, [
      seed,
      film("both", ["Sci-Fi", "Drama"], { year: 2012 }),
      film("one", ["Sci-Fi"], { year: 1960 }),
      film("none", ["Comedy"]),
      film("show", ["Sci-Fi", "Drama"], { type: "series" }),
      item({ id: "ch", genres: ["Sci-Fi"] }),
      film("gone", ["Sci-Fi", "Drama"], { availability: "unavailable" }),
    ]);
    expect(result.map((c) => c.id)).toEqual(["both", "one"]);
  });
  it("returns nothing for channels or titles without genres", () => {
    expect(similarTo(item(), [seed])).toEqual([]);
    expect(similarTo(film("bare", []), [seed])).toEqual([]);
  });
  it("honors the limit", () => {
    const pool = Array.from({ length: 30 }, (_, i) => film(`f${i}`, ["Drama"]));
    expect(similarTo(seed, pool, 5)).toHaveLength(5);
  });
});
