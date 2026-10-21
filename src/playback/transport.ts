import { mediaUrl } from "../domain/urls";
import { createTransport, type PlaybackResolver } from "./route";
export interface RelayConnection {
  base: string;
  secret: string;
  mode: "http" | "all";
}
export type { PlaybackResolver, Resolution } from "./route";
export function relayBase(value: string): string | null {
  const safe = mediaUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    return null;
  return url.origin;
}
// The media resolver for this device: direct, the HTTPS version, the TV app's route, then
// the relay you configured (see route.ts).
export function playbackResolver(
  connection: RelayConnection | null,
): PlaybackResolver {
  return createTransport({ relay: connection });
}
