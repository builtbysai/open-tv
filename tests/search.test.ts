import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import {
  buildRankedIndex,
  distance,
  parseQuery,
  rankSearch,
} from "../src/domain/search";
import type { Content } from "../src/domain/content";
const film = (title: string, patch: Partial<Content> = {}) =>
  item({ id: title, title, type: "movie", genres: ["Drama"], ...patch });
const titles = (list: Content[]) => list.map((c) => c.title);
describe("search ranking", () => {
  const index = buildRankedIndex([
    film("The Dark Knight", { year: 2008 }),
    film("Knight and Day", { year: 2010 }),
    film("Dune", { year: 1984 }),
    film("Dune", { id: "dune21", year: 2021 }),
    film("Dune: Part Two", { id: "dune24", year: 2024 }),
    film("Amélie", { year: 2001 }),
    film("Oppenheimer", { year: 2023 }),
    item({ id: "ch", title: "Dune TV", type: "live" }),
    item({
      id: "series",
      title: "Severance",
      type: "series",
      genres: ["Thriller"],
    }),
  ]);
  it("ranks exact and prefix title matches first", () => {
    expect(titles(rankSearch(index, "dune"))[0]).toBe("Dune");
    expect(titles(rankSearch(index, "knight"))).toEqual([
      "Knight and Day",
      "The Dark Knight",
    ]);
    expect(titles(rankSearch(index, "dark kni"))).toEqual(["The Dark Knight"]);
  });
  it("uses a year to prefer the right edition", () => {
    const result = rankSearch(index, "dune 2021");
    expect(result[0].id).toBe("dune21");
    expect(parseQuery("dune 2021")).toMatchObject({
      tokens: ["dune"],
      year: 2021,
    });
  });
  it("understands type words", () => {
    expect(titles(rankSearch(index, "dune movies"))).not.toContain("Dune TV");
    expect(titles(rankSearch(index, "channels"))).toEqual(["Dune TV"]);
    expect(titles(rankSearch(index, "series"))).toEqual(["Severance"]);
  });
  it("tolerates typos, accents and missing punctuation", () => {
    expect(titles(rankSearch(index, "oppenhiemer"))).toEqual(["Oppenheimer"]);
    expect(titles(rankSearch(index, "amelie"))).toEqual(["Amélie"]);
    expect(titles(rankSearch(index, "dune part 2"))).toEqual([]);
    expect(titles(rankSearch(index, "severence"))).toEqual(["Severance"]);
    expect(titles(rankSearch(index, "dark knigt"))).toEqual([
      "The Dark Knight",
    ]);
    expect(titles(rankSearch(index, "dak"))).toEqual([]);
    expect(titles(rankSearch(index, "dak knight"))).toContain(
      "The Dark Knight",
    );
  });
  it("matches genres only as a fallback and never returns noise", () => {
    expect(titles(rankSearch(index, "thriller"))).toEqual(["Severance"]);
    expect(rankSearch(index, "zzzzqq")).toEqual([]);
    expect(rankSearch(index, "")).toEqual([]);
  });
  it("computes bounded edit distance", () => {
    expect(distance("kitten", "sitten", 1)).toBe(1);
    expect(distance("ab", "ba", 1)).toBe(1);
    expect(distance("abcdef", "uvwxyz", 2)).toBe(3);
  });
});
