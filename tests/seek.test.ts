import { describe, expect, it } from "vitest";
import { seekBy } from "../src/playback/seek";

const ranges = (start: number, end: number): TimeRanges => ({
  length: 1,
  start: () => start,
  end: () => end,
});
describe("viewer seeking", () => {
  it("clamps VOD to its duration without requiring buffered media", () => {
    const video = {
      currentTime: 3,
      duration: 60,
      seekable: { ...ranges(0, 0), length: 0 },
    };
    expect(seekBy(video, -10)).toBe(true);
    expect(video.currentTime).toBe(0);
    seekBy(video, 90);
    expect(video.currentTime).toBe(60);
  });
  it("clamps live DVR seeks to the moving window, including an expired position", () => {
    const video = {
      currentTime: 101,
      duration: Infinity,
      seekable: ranges(100, 130),
    };
    seekBy(video, -10);
    expect(video.currentTime).toBe(100);
    seekBy(video, 60);
    expect(video.currentTime).toBe(130);
    video.currentTime = 80;
    seekBy(video, 10);
    expect(video.currentTime).toBe(100);
  });
  it("ignores unready/non-seekable streams and rejected native seeks", () => {
    const video = {
      currentTime: 5,
      duration: NaN,
      seekable: { ...ranges(0, 0), length: 0 },
    };
    expect(seekBy(video, 10)).toBe(false);
    expect(video.currentTime).toBe(5);
    Object.defineProperty(video, "currentTime", {
      get: () => 5,
      set: () => {
        throw new Error("not ready");
      },
    });
    video.duration = 60;
    expect(seekBy(video, 10)).toBe(false);
    expect(seekBy(video, Infinity)).toBe(false);
  });
});
