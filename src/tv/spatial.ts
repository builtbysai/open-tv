export type Direction = "left" | "right" | "up" | "down";
export interface FocusRect {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function nearestFocus(
  origin: FocusRect,
  candidates: FocusRect[],
  direction: Direction,
): number | undefined {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const center = (r: FocusRect) =>
    horizontal ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
  let best: number | undefined,
    score = Infinity;
  for (const candidate of candidates) {
    if (
      candidate.id === origin.id ||
      sign * (center(candidate) - center(origin)) < 2
    )
      continue;
    const gap = horizontal
      ? Math.max(
          0,
          sign > 0
            ? candidate.left - origin.right
            : origin.left - candidate.right,
        )
      : Math.max(
          0,
          sign > 0
            ? candidate.top - origin.bottom
            : origin.top - candidate.bottom,
        );
    const crossGap = horizontal
      ? Math.max(
          0,
          candidate.top - origin.bottom,
          origin.top - candidate.bottom,
        )
      : Math.max(
          0,
          candidate.left - origin.right,
          origin.left - candidate.right,
        );
    const crossCenter = horizontal
      ? Math.abs(
          (candidate.top + candidate.bottom - origin.top - origin.bottom) / 2,
        )
      : Math.abs(
          (candidate.left + candidate.right - origin.left - origin.right) / 2,
        );
    // A candidate in the same row (or column) always wins over one outside it, the way
    // Android's focus finder does, so a large neighbour never steals a sideways move.
    const rank =
      (crossGap > 0 ? 100000 : 0) +
      gap +
      crossGap * 4 +
      crossCenter * 0.15 +
      Math.abs(center(candidate) - center(origin)) * 0.01;
    if (rank < score) {
      score = rank;
      best = candidate.id;
    }
  }
  return best;
}
