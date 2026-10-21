import type { VideoEvidence } from "../playback/probe";
import type { StorageLike } from "./user-state";
export const VIDEO_HEALTH_KEY = "opentv:video-health:v1";
export const VIDEO_HEALTH_TTL = 24 * 60 * 60 * 1000;
const statuses = [
  "video-confirmed",
  "audio-only",
  "unconfirmed",
  "blocked",
  "unsupported",
  "failed",
  "aborted",
];
export function readVideoHealth(
  storage: Pick<StorageLike, "getItem">,
  now = Date.now(),
): Record<string, VideoEvidence> {
  try {
    const data: unknown = JSON.parse(storage.getItem(VIDEO_HEALTH_KEY) || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data)
        .filter(
          ([id, v]) =>
            /^ot-[a-z0-9]+$/.test(id) &&
            v &&
            typeof v === "object" &&
            statuses.includes(v.status) &&
            Number.isFinite(v.checkedAt) &&
            v.checkedAt <= now + 60000 &&
            now - v.checkedAt < VIDEO_HEALTH_TTL &&
            (v.status !== "video-confirmed" ||
              (v.width > 0 && v.height > 0 && v.frames >= 2)) &&
            [v.width, v.height, v.frames, v.elapsedMs].every(
              (n) => Number.isFinite(n) && n >= 0,
            ),
        )
        .slice(0, 200),
    );
  } catch {
    return {};
  }
}
export function saveVideoHealth(
  storage: StorageLike,
  id: string,
  value: VideoEvidence,
): void {
  if (!/^ot-[a-z0-9]+$/.test(id) || value.status === "aborted") return;
  try {
    storage.setItem(
      VIDEO_HEALTH_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries({ ...readVideoHealth(storage), [id]: value })
            .sort((a, b) => b[1].checkedAt - a[1].checkedAt)
            .slice(0, 200),
        ),
      ),
    );
  } catch {
    /* Health cache is disposable. */
  }
}
