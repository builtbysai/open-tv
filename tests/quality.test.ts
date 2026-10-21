import { describe, expect, it } from "vitest";
import { qualityBadge } from "../src/domain/quality";
const item = (title: string, quality = "") => ({
  title,
  streams: [{ url: "https://x/y", format: "video" as const, quality }],
});
describe("quality badge", () => {
  it("reads the size and HDR from the title or stream", () => {
    expect(qualityBadge(item("Dune (2021) 2160p HDR10"))).toBe("4K HDR");
    expect(qualityBadge(item("Heat", "1080p"))).toBe("1080p");
    expect(qualityBadge(item("Alien 720p BluRay"))).toBe("720p");
    expect(qualityBadge(item("Plain title"))).toBeUndefined();
  });
  it("does not mistake a title for a size", () => {
    expect(qualityBadge(item("Channel 4K Kids"))).toBe("4K");
    expect(qualityBadge(item("The 1080 Club"))).toBeUndefined();
  });
});
