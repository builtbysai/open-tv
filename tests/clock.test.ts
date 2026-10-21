import { describe, expect, it } from "vitest";
import { clock, wholeSeconds } from "../src/playback/clock";

describe("playback clock", () => {
  it("floors the same way the seek bar does", () => {
    expect(wholeSeconds(13.9)).toBe(13);
    expect(clock(13.9)).toBe("0:13");
    expect(clock(wholeSeconds(13.9))).toBe(clock(13.9));
  });
  it("formats hours and ignores bad values", () => {
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(NaN)).toBe("0:00");
    expect(clock(-4)).toBe("0:00");
    expect(wholeSeconds(Infinity)).toBe(0);
  });
});
