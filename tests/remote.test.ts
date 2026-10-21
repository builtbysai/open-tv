import { describe, expect, it } from "vitest";
import { nearestFocus, type FocusRect } from "../src/tv/spatial";
const box = (
  id: number,
  left: number,
  top: number,
  width = 100,
  height = 60,
): FocusRect => ({ id, left, top, right: left + width, bottom: top + height });
describe("TV directional focus", () => {
  it("follows aligned rows before diagonal controls, including an offscreen rail card", () => {
    const origin = box(0, 200, 100);
    expect(
      nearestFocus(
        origin,
        [origin, box(1, 330, 100), box(2, 285, 15, 30, 30)],
        "right",
      ),
    ).toBe(1);
    expect(
      nearestFocus(
        box(0, 1800, 100),
        [box(1, 2000, 100), box(2, 1800, 300)],
        "right",
      ),
    ).toBe(1);
  });
  it("moves vertically through a grid and never wraps to the opposite edge", () => {
    const origin = box(0, 200, 200);
    const items = [
      origin,
      box(1, 200, 100),
      box(2, 200, 300),
      box(3, 330, 200),
    ];
    expect(nearestFocus(origin, items, "up")).toBe(1);
    expect(nearestFocus(origin, items, "down")).toBe(2);
    expect(nearestFocus(origin, items, "left")).toBeUndefined();
  });
  it("keeps ties deterministic and has no target when a dialog exposes no candidate", () => {
    expect(nearestFocus(box(0, 0, 0), [], "right")).toBeUndefined();
    expect(
      nearestFocus(box(0, 0, 0), [box(2, 200, 0), box(1, 200, 0)], "right"),
    ).toBe(2);
  });
});
