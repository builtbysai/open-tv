import { rankAudio } from "./audio";
import { getJson, httpsUrl, list, num, obj, str } from "./http";
import type { AudioStream, MusicApi, Song } from "./types";

// Piped: GET {api}/search?filter=music_songs, /streams/{id}, /trending, /playlists/{id}.
export function piped(base: string): MusicApi {
  const root = base.replace(/\/+$/, "");
  const idOf = (url: unknown) => {
    try {
      return (
        new URL(String(url), "https://piped.invalid").searchParams.get("v") ??
        ""
      );
    } catch {
      return "";
    }
  };
  const song = (raw: unknown): Song | null => {
    const v = obj(raw);
    const id = idOf(v.url);
    const title = str(v.title);
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id) || !title) return null;
    return {
      id,
      title,
      artist: str(v.uploaderName, 120).replace(/ - Topic$/, ""),
      thumbnail: httpsUrl(v.thumbnail, root),
      duration:
        num(v.duration) && Number(v.duration) > 0
          ? Number(v.duration)
          : undefined,
    };
  };
  const songs = (items: unknown[]) =>
    items.map(song).filter((s): s is Song => !!s);
  const search = async (q: string, signal?: AbortSignal) =>
    songs(
      list(
        obj(
          await getJson(
            `${root}/search?${new URLSearchParams({ q, filter: "music_songs" })}`,
            signal,
          ),
        ).items,
      ),
    );
  return {
    searchSongs: search,
    async resolveAudio(id, signal) {
      const data = obj(
        await getJson(`${root}/streams/${encodeURIComponent(id)}`, signal),
      );
      const out: AudioStream[] = [];
      for (const f of list(data.audioStreams).map(obj)) {
        const url = httpsUrl(f.url, root);
        const mime = str(f.mimeType, 80).split(";")[0];
        if (url) out.push({ url, mime, bitrate: num(f.bitrate) ?? 0 });
      }
      return rankAudio(out);
    },
    // Piped's API address is not a player page, so its fallback is the video host's own
    // privacy-friendly embed.
    embedUrl: (id) =>
      `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`,
    // Piped has no music chart of its own: this asks its music search for current hits.
    trending: (signal) => search("top music hits this week", signal),
    async playlist(playlistId, signal) {
      const data = obj(
        await getJson(
          `${root}/playlists/${encodeURIComponent(playlistId)}`,
          signal,
        ),
      );
      return songs(list(data.relatedStreams));
    },
  };
}
