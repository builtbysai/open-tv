import { describe, expect, it } from "vitest";
import { isKidsSafe } from "../src/domain/kids";
describe("kids view", () => {
  it("keeps titles tagged for children and drops everything else", () => {
    const base = { classification: "general" as const };
    expect(isKidsSafe({ ...base, genres: ["Animation"] })).toBe(true);
    expect(isKidsSafe({ ...base, genres: ["Drama", "Family"] })).toBe(true);
    expect(isKidsSafe({ ...base, genres: ["Kids"] })).toBe(true);
    expect(isKidsSafe({ ...base, genres: ["Horror"] })).toBe(false);
    expect(isKidsSafe({ ...base, genres: [] })).toBe(false);
    expect(isKidsSafe({ classification: "adult", genres: ["Animation"] })).toBe(
      false,
    );
  });
});
