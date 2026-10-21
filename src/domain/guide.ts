import type { GuideProgram } from "../providers/contracts";
export type GuideIndex = Map<string, GuideProgram[]>;
export interface GuideSegment {
  program: GuideProgram;
  left: number;
  width: number;
}
export const GUIDE_HOUR = 3600000;
export function indexGuide(programs: GuideProgram[]): GuideIndex {
  const index: GuideIndex = new Map();
  const seen = new Set<string>();
  for (const program of programs) {
    if (
      !program.channelId ||
      !Number.isFinite(program.start) ||
      !Number.isFinite(program.end) ||
      program.end <= program.start
    )
      continue;
    const key = `${program.channelId}\0${program.start}\0${program.end}\0${program.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entries = index.get(program.channelId) || [];
    entries.push(program);
    index.set(program.channelId, entries);
  }
  for (const entries of index.values())
    entries.sort((a, b) => a.start - b.start || a.end - b.end);
  return index;
}
export function guideWindow(now: number, offset = 0) {
  const start =
    Math.floor(now / (GUIDE_HOUR / 2)) * (GUIDE_HOUR / 2) +
    offset * GUIDE_HOUR * 3;
  return { start, end: start + GUIDE_HOUR * 3 };
}
export function guideSegments(
  index: GuideIndex,
  channelId: string,
  start: number,
  end: number,
): GuideSegment[] {
  if (!channelId || end <= start) return [];
  let occupied = start;
  const segments: GuideSegment[] = [];
  for (const program of index.get(channelId) || []) {
    if (program.end <= start) continue;
    if (program.start >= end) break;
    const from = Math.max(start, program.start, occupied),
      to = Math.min(end, program.end);
    if (to <= from) continue;
    segments.push({
      program,
      left: ((from - start) / (end - start)) * 100,
      width: ((to - from) / (end - start)) * 100,
    });
    occupied = to;
  }
  return segments;
}
