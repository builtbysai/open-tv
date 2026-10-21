import { describe, expect, it } from "vitest";
import {
  normalizeCountries,
  normalizeLanguages,
} from "../src/domain/languages";
describe("language names", () => {
  it("splits joined lists, maps codes and capitalises", () => {
    expect(normalizeLanguages(["English,german"])).toEqual([
      "English",
      "German",
    ]);
    expect(normalizeLanguages(["fre", "jap", "sgn"])).toEqual([
      "French",
      "Japanese",
      "Sign language",
    ]);
  });
  it("drops repeats and blanks", () => {
    expect(normalizeLanguages(["eng", "English", " ", "ENG;spa"])).toEqual([
      "English",
      "Spanish",
    ]);
  });
  it("keeps a name it does not know, capitalised", () => {
    expect(normalizeLanguages(["swahili"])).toEqual(["Swahili"]);
  });
});
describe("junk and countries", () => {
  it("drops codecs and tags that are not languages", () => {
    expect(
      normalizeLanguages(["Aac", "Hls", "Mp3", "#original", "English"]),
    ).toEqual(["English"]);
  });
  it("shows country names for codes and keeps names", () => {
    expect(normalizeCountries(["US", "gb", "Canada"])).toEqual([
      "United States",
      "United Kingdom",
      "Canada",
    ]);
    expect(normalizeCountries(["ZZ"])).toEqual(["ZZ"]);
  });
  it("joins spellings of one country into a single option", () => {
    expect(
      normalizeCountries([
        "US",
        "United States",
        "USA",
        "United States of America",
      ]),
    ).toEqual(["United States"]);
    expect(normalizeCountries(["Turkiye", "TR", "Turkey"])).toEqual([
      normalizeCountries(["TR"])[0],
    ]);
    expect(normalizeCountries(["UK", "GB"])).toEqual(["United Kingdom"]);
  });
});
