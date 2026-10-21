import { describe, expect, it } from "vitest";
import { licenseLabel } from "../src/domain/rights";
import { deduplicate } from "../src/domain/content";
import { item } from "./fixtures";

describe("licenseLabel", () => {
  it("names Creative Commons licenses", () => {
    expect(licenseLabel("https://creativecommons.org/licenses/by/3.0/")).toBe(
      "CC BY 3.0",
    );
    expect(licenseLabel("https://creativecommons.org/licenses/by-sa/4.0")).toBe(
      "CC BY-SA 4.0",
    );
    expect(
      licenseLabel("https://creativecommons.org/publicdomain/zero/1.0/"),
    ).toBe("Public domain (CC0)");
  });
  it("falls back to the host or the text", () => {
    expect(licenseLabel("https://example.org/terms")).toBe("example.org");
    expect(licenseLabel("CC BY 3.0")).toBe("CC BY 3.0");
    expect(licenseLabel(undefined)).toBe("Open license");
  });
});
describe("archive duplicates", () => {
  const archive = (id: string, title: string, year?: number) => ({
    ...item({ id, title, type: "movie", year }),
    rights: {
      status: "public-domain" as const,
      attribution: "Internet Archive",
    },
    streams: [],
  });
  it("merges the same film listed twice or with a series prefix", () => {
    const out = deduplicate([
      archive("a", "Shuteye Popeye", 1952),
      archive("b", "Shuteye Popeye", 1952),
      archive("c", "Taxi-Turvy", 1952),
      archive("d", "Popeye: Taxi-Turvy", 1952),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "c"]);
    expect(out[0].aliases).toContain("b");
  });
  it("keeps similar titles with different years or other sources apart", () => {
    const other = {
      ...archive("x", "Shuteye Popeye", 1952),
      rights: { status: "unverified" as const },
    };
    expect(
      deduplicate([
        archive("a", "Shuteye Popeye", 1952),
        archive("b", "Shuteye Popeye", 1953),
        other,
      ]),
    ).toHaveLength(3);
  });
});
