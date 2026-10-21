import type { StorageLike } from "./user-state";
// The audio track a viewer picked, per title: small and bounded, the newest kept.
export const AUDIO_CHOICE_KEY = "opentv:audio-choice:v1";
const LIMIT = 100;
export interface RememberedAudio {
  lang?: string;
  codec?: string;
  name?: string;
}
const clean = (value: unknown, max: number) =>
  typeof value === "string" && value ? value.slice(0, max) : undefined;
function readAll(storage: Pick<StorageLike, "getItem">) {
  try {
    const data: unknown = JSON.parse(storage.getItem(AUDIO_CHOICE_KEY) || "{}");
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, RememberedAudio>)
      : {};
  } catch {
    return {};
  }
}
export function readAudioChoice(
  storage: Pick<StorageLike, "getItem">,
  id: string,
): RememberedAudio | undefined {
  const entry = readAll(storage)[id];
  if (!entry || typeof entry !== "object") return undefined;
  return {
    lang: clean(entry.lang, 20),
    codec: clean(entry.codec, 40),
    name: clean(entry.name, 80),
  };
}
export function saveAudioChoice(
  storage: Pick<StorageLike, "getItem" | "setItem">,
  id: string,
  choice: RememberedAudio,
) {
  const all = readAll(storage);
  delete all[id];
  all[id.slice(0, 200)] = {
    lang: clean(choice.lang, 20),
    codec: clean(choice.codec, 40),
    name: clean(choice.name, 80),
  };
  const kept = Object.entries(all).slice(-LIMIT);
  storage.setItem(AUDIO_CHOICE_KEY, JSON.stringify(Object.fromEntries(kept)));
}
