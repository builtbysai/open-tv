import { serverAddress } from "../domain/servers";
import { diagnose } from "../domain/errors";
import {
  musicProviderTypes,
  SONG_ID,
  type MusicProvider,
  type Song,
} from "../music/types";

export const MUSIC_PROVIDERS_KEY = "opentv:music-providers:v1";
export const MUSIC_CHECKS_KEY = "opentv:music-checks:v1";
const LOOKUPS_KEY = "opentv:music-lookups:v1";
const RECENT_KEY = "opentv:music-recent:v1";

export function validateMusicProvider(value: unknown): MusicProvider | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const base = typeof p.base === "string" ? serverAddress(p.base) : null;
  if (
    typeof p.id !== "string" ||
    !/^ot-[a-z0-9]{1,60}$/.test(p.id) ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    !base ||
    !musicProviderTypes.includes(p.type as MusicProvider["type"])
  )
    return null;
  return {
    id: p.id,
    name: p.name.trim().slice(0, 100),
    type: p.type as MusicProvider["type"],
    base,
    enabled: p.enabled !== false,
  };
}
// The list order is the order they are tried in.
export function readMusicProviders(
  storage: Pick<Storage, "getItem">,
): MusicProvider[] {
  try {
    const value = JSON.parse(storage.getItem(MUSIC_PROVIDERS_KEY) || "null");
    if (value?.version !== 1 || !Array.isArray(value.providers)) return [];
    const seen = new Set<string>();
    const out: MusicProvider[] = [];
    for (const raw of value.providers.slice(0, 50)) {
      const p = validateMusicProvider(raw);
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  } catch {
    diagnose("music.read-failed");
    return [];
  }
}
export function writeMusicProviders(
  storage: Pick<Storage, "setItem">,
  providers: MusicProvider[],
): boolean {
  try {
    const safe = providers
      .map(validateMusicProvider)
      .filter((p): p is MusicProvider => !!p);
    storage.setItem(
      MUSIC_PROVIDERS_KEY,
      JSON.stringify({ version: 1, providers: safe }),
    );
    return true;
  } catch {
    diagnose("music.write-failed");
    return false;
  }
}
// Lyrics and album art are looked up on other sites; this switch turns that off.
export function lookupsEnabled(
  storage: Pick<Storage, "getItem"> | undefined,
): boolean {
  try {
    return storage?.getItem(LOOKUPS_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setLookupsEnabled(
  storage: Pick<Storage, "setItem"> | undefined,
  on: boolean,
) {
  try {
    storage?.setItem(LOOKUPS_KEY, on ? "on" : "off");
  } catch {
    /* The choice still applies for this visit. */
  }
}
// Songs played lately, so Listen again can show them after a reload.
export function readRecentSongs(
  storage: Pick<Storage, "getItem"> | undefined,
): Song[] {
  try {
    const value = JSON.parse(storage?.getItem(RECENT_KEY) || "[]");
    return (Array.isArray(value) ? value : [])
      .filter(
        (s) =>
          s &&
          typeof s.id === "string" &&
          SONG_ID.test(s.id) &&
          typeof s.title === "string",
      )
      .slice(0, 40)
      .map((s) => ({
        id: s.id,
        title: String(s.title).slice(0, 300),
        artist: String(s.artist || "").slice(0, 120),
        thumbnail:
          typeof s.thumbnail === "string" && s.thumbnail.startsWith("https://")
            ? s.thumbnail
            : undefined,
        duration: Number.isFinite(s.duration) ? s.duration : undefined,
        source:
          typeof s.source === "string" && s.source
            ? s.source.slice(0, 60)
            : undefined,
      }));
  } catch {
    return [];
  }
}
export function rememberSong(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  song: Song,
): Song[] {
  const next = [
    song,
    ...readRecentSongs(storage).filter((s) => s.id !== song.id),
  ].slice(0, 40);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Optional. */
  }
  return next;
}

// Lyrics a person loaded from an .lrc file for one song, kept on this device (the most
// recent 30 songs).
const LYRICS_KEY = "opentv:music-lyrics:v1";
export function readSavedLyrics(
  storage: Pick<Storage, "getItem"> | undefined,
  songId: string,
): string | undefined {
  try {
    const value = JSON.parse(storage?.getItem(LYRICS_KEY) || "[]");
    const hit = (Array.isArray(value) ? value : []).find(
      (e) => e && e.id === songId && typeof e.text === "string",
    );
    return hit?.text;
  } catch {
    return undefined;
  }
}
export function saveLyrics(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  songId: string,
  text: string,
) {
  try {
    const value = JSON.parse(storage?.getItem(LYRICS_KEY) || "[]");
    const rest = (Array.isArray(value) ? value : []).filter(
      (e) => e && e.id !== songId,
    );
    storage?.setItem(
      LYRICS_KEY,
      JSON.stringify(
        [{ id: songId, text: text.slice(0, 60000) }, ...rest].slice(0, 30),
      ),
    );
  } catch {
    /* The lyrics still show for this visit. */
  }
}
