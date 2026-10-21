type SeekableVideo = Pick<
  HTMLMediaElement,
  "currentTime" | "duration" | "seekable"
>;

/** Clamp VOD seeks and honor a live stream's moving DVR window. */
export function seekBy(video: SeekableVideo, seconds: number): boolean {
  if (!Number.isFinite(seconds)) return false;
  let start = 0,
    end = video.duration;
  if (!Number.isFinite(end)) {
    const ranges = video.seekable;
    if (!ranges.length) return false;
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
  if (end <= start) return false;
  try {
    video.currentTime = Math.max(
      start,
      Math.min(end, video.currentTime + seconds),
    );
    return true;
  } catch {
    // Some native players reject seeking during source replacement. A later user action can retry.
    return false;
  }
}
