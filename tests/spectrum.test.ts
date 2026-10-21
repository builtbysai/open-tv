import { describe, expect, it } from "vitest";
import {
  bandEdges,
  reduceBands,
  simulate,
  smooth,
  titleHue,
} from "../src/playback/spectrum";
describe("spectrum helpers", () => {
  it("builds increasing log edges with at least one bin per band", () => {
    const edges = bandEdges(256, 32);
    expect(edges).toHaveLength(33);
    for (let i = 1; i < edges.length; i++)
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });
  it("averages bands into 0-1", () => {
    const freq = new Uint8Array(64).fill(255);
    const bands = reduceBands(freq, bandEdges(64, 8));
    expect(bands).toHaveLength(8);
    expect(Math.min(...bands)).toBeCloseTo(1);
    expect(reduceBands(new Uint8Array(64), bandEdges(64, 8))[0]).toBe(0);
  });
  it("rises faster than it falls", () => {
    expect(smooth([0], [1])[0]).toBeGreaterThan(0.5);
    expect(smooth([1], [0])[0]).toBeGreaterThan(0.85);
  });
  it("simulates motion only while playing, within range", () => {
    expect(simulate(3, 16, false).every((v) => v === 0)).toBe(true);
    const bars = simulate(3, 16, true);
    expect(bars.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(new Set(bars.map((v) => v.toFixed(3))).size).toBeGreaterThan(4);
  });
  it("gives a title a stable hue", () => {
    expect(titleHue("Jazz FM")).toBe(titleHue("Jazz FM"));
    expect(titleHue("Jazz FM")).toBeLessThan(360);
  });
});
