import { stableId, type Content, type Stream } from "./content";
import { sensitiveUrl } from "./urls";
import type { VideoEvidence } from "../playback/probe";
import { VIDEO_HEALTH_TTL } from "../persistence/video-health";
export function videoSample(
  items: Content[],
  recent: Record<string, VideoEvidence>,
  now = Date.now(),
): { item: Content; stream: Stream }[] {
  const hosts = new Set<string>(),
    result: { item: Content; stream: Stream }[] = [];
  for (const item of items) {
    if (
      item.classification !== "general" ||
      item.availability !== "playable" ||
      item.serverId ||
      item.rights.status === "user-authorized"
    )
      continue;
    for (const stream of item.streams) {
      if (stream.format === "embed" || sensitiveUrl(stream.url)) continue;
      try {
        const url = new URL(stream.url),
          previous = recent[stableId(stream.url)];
        if (
          url.protocol !== "https:" ||
          hosts.has(url.hostname) ||
          /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(
            url.hostname,
          ) ||
          (previous && now - previous.checkedAt < VIDEO_HEALTH_TTL)
        )
          continue;
        hosts.add(url.hostname);
        result.push({ item, stream });
        break;
      } catch {
        /* Invalid directory entry. */
      }
    }
    if (result.length >= 4) break;
  }
  return result;
}
