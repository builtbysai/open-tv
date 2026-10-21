type SeekableVideo = Pick<
  HTMLMediaElement,
  "currentTime" | "duration" | "seekable"
>;

/** Where a seek may land: the VOD length, or a live stream's current DVR window. */
export function seekWindow(
  video: SeekableVideo,
): { start: number; end: number } | null {
  let start = 0,
    end = video.duration;
  if (!Number.isFinite(end)) {
    const ranges = video.seekable;
    if (!ranges.length) return null;
    let index = ranges.length - 1;
    for (let i = 0; i < ranges.length; i++) {
      if (
        video.currentTime >= ranges.start(i) &&
        video.currentTime <= ranges.end(i)
      ) {
        index = i;
        break;
      }
    }
    start = ranges.start(index);
    end = ranges.end(index);
  }
  return end > start ? { start, end } : null;
}

/** Clamp VOD seeks and honor a live stream's moving DVR window. */
export function seekBy(video: SeekableVideo, seconds: number): boolean {
  if (!Number.isFinite(seconds)) return false;
  const window = seekWindow(video);
  if (!window) return false;
  try {
    video.currentTime = Math.max(
      window.start,
      Math.min(window.end, video.currentTime + seconds),
    );
    return true;
  } catch {
    // Some native players reject seeking during source replacement. A later user action can retry.
    return false;
  }
}

/** One step of a held seek key: the base step at first, growing the longer it is held. */
export function seekStep(base: number, heldMs: number): number {
  if (heldMs < 1200) return base;
  if (heldMs < 3000) return Math.max(base, 30);
  return Math.max(base, 60);
}
