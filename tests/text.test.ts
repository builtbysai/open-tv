import { describe, expect, it } from "vitest";
import { clipText } from "../src/domain/text";
describe("clipText", () => {
  it("leaves short text alone", () => {
    expect(clipText("A short line.", 50)).toBe("A short line.");
  });
  it("cuts at a word boundary and marks it", () => {
    const text = "Internet Archive collection of vintage films and cartoons";
    const out = clipText(text, 30);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
    expect(out).toBe("Internet Archive collection…");
  });
  it("falls back to a hard cut for one long word", () => {
    expect(clipText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
