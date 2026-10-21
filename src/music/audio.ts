import type { AudioStream } from "./types";
// Best first: AAC in MP4 plays everywhere, Opus in WebM is a close second, and anything
// else comes last. Within a kind, the higher bitrate wins.
export function rankAudio(streams: AudioStream[]): AudioStream[] {
  const kind = (mime: string) =>
    /mp4|m4a|aac/i.test(mime) ? 3 : /opus|webm/i.test(mime) ? 2 : 1;
  return [...streams]
    .filter((s) => /^audio\//i.test(s.mime) || !s.mime)
    .sort((a, b) => kind(b.mime) - kind(a.mime) || b.bitrate - a.bitrate);
}
