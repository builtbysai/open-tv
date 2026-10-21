import { describe, expect, it } from "vitest";
import { nearestFocus } from "../src/tv/spatial";
const box = (id: number, left: number, top: number, w: number, h: number) => ({
  id,
  left,
  top,
  right: left + w,
  bottom: top + h,
});
describe("nearestFocus", () => {
  // The TV player: a wide picture above a row of controls.
  const picture = box(0, 0, 84, 960, 300);
  const pause = box(1, 48, 398, 117, 48);
  const rewind = box(2, 185, 400, 44, 44);
  const forward = box(3, 718, 400, 44, 44);
  const all = [picture, pause, rewind, forward];
  it("moves along a row before leaving it", () => {
    expect(nearestFocus(forward, all, "left")).toBe(2);
    expect(nearestFocus(rewind, all, "left")).toBe(1);
    expect(nearestFocus(pause, all, "right")).toBe(2);
  });
  it("leaves the row when nothing is left in it", () => {
    expect(nearestFocus(pause, all, "up")).toBe(0);
    expect(nearestFocus(pause, all, "left")).toBeUndefined();
  });
});
