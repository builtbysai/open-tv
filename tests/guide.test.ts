import { describe, it, expect } from "vitest";
import {
  GUIDE_HOUR,
  guideSegments,
  guideWindow,
  indexGuide,
} from "../src/domain/guide";
const program = (title: string, start: number, end: number) => ({
  channelId: "news",
  title,
  start,
  end,
});
describe("time-scaled guide", () => {
  it("sorts and deduplicates real schedule records without filling gaps", () => {
    const a = program("A", 0, 30),
      b = program("B", 60, 90);
    const index = indexGuide([b, a, a, { ...a, end: -1 }]);
    expect(index.get("news")).toEqual([a, b]);
    expect(
      guideSegments(index, "news", 0, 120).map((s) => [s.left, s.width]),
    ).toEqual([
      [0, 25],
      [50, 25],
    ]);
    expect(guideSegments(index, "unmatched", 0, 120)).toEqual([]);
  });
  it("clips partial programs and overlapping records at the displayed window", () => {
    const index = indexGuide([
      program("Past", -30, 30),
      program("Overlap", 20, 90),
      program("Later", 110, 150),
    ]);
    const slots = guideSegments(index, "news", 0, 120);
    expect(slots.map((s) => [s.left, s.width])).toEqual([
      [0, 25],
      [25, 50],
      [(110 / 120) * 100, (10 / 120) * 100],
    ]);
    expect(slots.every((s) => s.left >= 0 && s.left + s.width <= 100)).toBe(
      true,
    );
  });
  it("anchors half-hour ticks and advances by a bounded three-hour window", () => {
    const now = Date.UTC(2026, 9, 18, 12, 45),
      window = guideWindow(now);
    expect(window.start).toBe(Date.UTC(2026, 9, 18, 12, 30));
    expect(window.end - window.start).toBe(3 * GUIDE_HOUR);
    expect(guideWindow(now, 1).start).toBe(window.end);
  });
});
