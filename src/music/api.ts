import { archive } from "./archive";
import { audius } from "./audius";
import { invidious } from "./invidious";
import { piped } from "./piped";
import type { MusicApi, MusicProvider } from "./types";

// The one place that knows the provider types.
export function musicApi(
  provider: Pick<MusicProvider, "type" | "base">,
): MusicApi {
  return provider.type === "piped"
    ? piped(provider.base)
    : provider.type === "audius"
      ? audius(provider.base)
      : provider.type === "archive"
        ? archive(provider.base)
        : invidious(provider.base);
}
