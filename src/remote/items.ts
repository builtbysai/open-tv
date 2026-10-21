import type { Content, ContentType, Stream } from "../domain/content";
import type { ItemRef, NowPlaying } from "./protocol";

const TYPES: ContentType[] = [
  "live",
  "movie",
  "series",
  "episode",
  "anime",
  "documentary",
  "radio",
  "audio",
];
const FORMATS: Stream["format"][] = ["hls", "video", "audio", "embed"];
const http = (value?: string) =>
  value && /^https?:\/\//.test(value) ? value : undefined;

// What the phone sends: the item plus the stream addresses it already has, so the TV can
// play it without having that source connected.
export function toItemRef(item: Content): ItemRef {
  const artwork =
    http(item.poster) || http(item.artwork) || http(item.backdrop);
  return {
    sourceId: item.providerId,
    itemId: item.id,
    type: item.type,
    title: item.title,
    ...(item.artist ? { subtitle: item.artist } : {}),
    ...(artwork ? { artwork } : {}),
    classification: item.classification,
    streams: item.streams.slice(0, 6).map((s) => ({
      url: s.url,
      format: s.format,
      ...(s.guard ? { guard: s.guard } : {}),
    })),
  };
}

// The TV's catalog entry when it has the same item, else one built from what was sent.
export function contentFromRef(ref: ItemRef, catalog?: Content[]): Content {
  const known = catalog?.find((c) => c.id === ref.itemId);
  if (known && known.streams.length) return known;
  const streams: Stream[] = ref.streams
    .filter((s) => FORMATS.includes(s.format as Stream["format"]))
    .map((s) => ({
      url: s.url,
      format: s.format as Stream["format"],
      ...(s.guard ? { guard: s.guard } : {}),
    }));
  return {
    id: ref.itemId,
    providerId: ref.sourceId,
    title: ref.title,
    ...(ref.subtitle ? { artist: ref.subtitle } : {}),
    type: TYPES.includes(ref.type as ContentType)
      ? (ref.type as ContentType)
      : "movie",
    ...(ref.artwork ? { artwork: ref.artwork, poster: ref.artwork } : {}),
    genres: [],
    languages: [],
    countries: [],
    classification: ref.classification,
    availability: streams.length ? "playable" : "unavailable",
    streams,
    rights: { status: "user-authorized" },
  };
}

// Where the TV is now, moved on by the time since the state arrived (the phone's own
// clock, so a difference between the two clocks doesn't matter).
export function positionNow(
  state: NowPlaying,
  receivedAt: number,
  now = Date.now(),
): number {
  if (state.phase !== "playing") return state.position;
  const moved = state.position + Math.max(0, now - receivedAt) / 1000;
  return state.duration > 0 ? Math.min(state.duration, moved) : moved;
}
