import { getJson, httpsUrl, list, num, obj, str } from "./http";
import type { AudioStream, MusicApi, Song } from "./types";

// Audius is an open music service with a public API: no key, and it allows browser
// requests. Its song ids are shown with a prefix so they never collide with video ids.
export const AUDIUS_PREFIX = "au_";
const APP = "app_name=opentv";
export const isAudiusId = (id: string) => id.startsWith(AUDIUS_PREFIX);
const bare = (id: string) => id.slice(AUDIUS_PREFIX.length);

// GET {base}/v1/tracks/search, /tracks/trending, /tracks/{id}/stream, /playlists/{id}/tracks.
export function audius(base: string): MusicApi {
  const root = base.replace(/\/+$/, "");
  const song = (raw: unknown): Song | null => {
    const t = obj(raw);
    const id = str(t.id, 20);
    const title = str(t.title);
    if (
      !/^[A-Za-z0-9]{3,20}$/.test(id) ||
      !title ||
      t.is_streamable === false ||
      t.is_delete === true ||
      t.is_unlisted === true
    )
      return null;
    const art = obj(t.artwork);
    return {
      id: AUDIUS_PREFIX + id,
      title,
      artist: str(obj(t.user).name, 120),
      thumbnail: httpsUrl(art["480x480"] ?? art["150x150"], root),
      duration: num(t.duration),
    };
  };
  const songs = (value: unknown) =>
    list(obj(value).data)
      .map(song)
      .filter((s): s is Song => !!s);
  return {
    async searchSongs(query, signal) {
      return songs(
        await getJson(
          `${root}/v1/tracks/search?${new URLSearchParams({ query, limit: "30" })}&${APP}`,
          signal,
        ),
      );
    },
    // The stream address answers with a redirect to the audio file, which a player follows.
    async resolveAudio(id): Promise<AudioStream[]> {
      return [
        {
          url: `${root}/v1/tracks/${encodeURIComponent(bare(id))}/stream?${APP}`,
          mime: "audio/mpeg",
          bitrate: 320000,
        },
      ];
    },
    embedUrl: () => null,
    async trending(signal) {
      return songs(
        await getJson(`${root}/v1/tracks/trending?limit=30&${APP}`, signal),
      );
    },
    async playlist(playlistId, signal) {
      return songs(
        await getJson(
          `${root}/v1/playlists/${encodeURIComponent(playlistId)}/tracks?${APP}`,
          signal,
        ),
      );
    },
  };
}
