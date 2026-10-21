export interface LyricLine {
  // Seconds from the start of the song.
  time: number;
  text: string;
}
// "[01:23.45] words" lines, possibly with several stamps; returns them in time order.
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [
      ...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g),
    ];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) {
      const fraction = m[3] ? Number(`0.${m[3]}`) : 0;
      out.push({
        time: Number(m[1]) * 60 + Number(m[2]) + fraction,
        text: words,
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
// The line being sung at `time`: the last one that has started, or -1 before the first.
export function activeLine(lines: LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}
