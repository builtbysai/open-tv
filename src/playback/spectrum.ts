// Pure helpers for the audio visualizer: turning an FFT into a handful of bands, easing
// them so the bars move smoothly, and a stand-in spectrum for streams the browser will
// not let us analyse (cross-origin media without CORS headers).

// Logarithmic band edges over the usable part of the spectrum, so bass does not hog the display.
export function bandEdges(bins: number, bands: number): number[] {
  const low = 1,
    high = Math.max(bands + 1, Math.floor(bins * 0.75));
  const edges: number[] = [];
  for (let i = 0; i <= bands; i++)
    edges.push(Math.round(low * Math.pow(high / low, i / bands)));
  // Every band covers at least one bin.
  for (let i = 1; i < edges.length; i++)
    edges[i] = Math.max(edges[i], edges[i - 1] + 1);
  return edges;
}
// Average each band of a byte spectrum (0-255) into 0-1.
export function reduceBands(
  freq: ArrayLike<number>,
  edges: number[],
): number[] {
  const out: number[] = [];
  for (let b = 0; b < edges.length - 1; b++) {
    let sum = 0,
      count = 0;
    for (let i = edges[b]; i < edges[b + 1] && i < freq.length; i++) {
      sum += freq[i];
      count++;
    }
    out.push(count ? sum / count / 255 : 0);
  }
  return out;
}
// Rise quickly, fall slowly.
export function smooth(
  previous: number[],
  next: number[],
  attack = 0.6,
  decay = 0.12,
): number[] {
  return next.map((value, i) => {
    const old = previous[i] ?? 0;
    return old + (value - old) * (value > old ? attack : decay);
  });
}
// A gentle, believable motion for the bars when the real spectrum is unavailable. It is
// decoration only and is shown as such: the player labels it "Visualizer".
export function simulate(
  time: number,
  bands: number,
  playing: boolean,
): number[] {
  if (!playing) return new Array(bands).fill(0);
  return Array.from({ length: bands }, (_, i) => {
    const weight = 1 - (i / bands) * 0.65;
    const a = Math.sin(time * 1.9 + i * 0.55) * 0.5 + 0.5;
    const b = Math.sin(time * 0.73 + i * 1.31) * 0.5 + 0.5;
    const c = Math.sin(time * 3.7 + i * 0.17) * 0.5 + 0.5;
    return Math.min(1, (0.15 + 0.5 * a * b + 0.35 * c * a) * weight + 0.04);
  });
}
// A stable hue for a title, so each piece of audio keeps its own colour.
export function titleHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++)
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return hash % 360;
}
