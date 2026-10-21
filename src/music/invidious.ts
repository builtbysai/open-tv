import { rankAudio } from "./audio";
import { getJson, httpsUrl, list, num, obj, str } from "./http";
import type { AudioStream, MusicApi, Song } from "./types";

// Invidious: GET {base}/api/v1/search, /videos/{id}, /trending, /playlists/{id}.
export function invidious(base: string): MusicApi {
  const root = base.replace(/\/+$/, "");
  const song = (raw: unknown): Song | null => {
    const v = obj(raw);
    const id = str(v.videoId, 20);
    const title = str(v.title);
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id) || !title) return null;
    const thumbs = list(v.videoThumbnails).map(obj);
    const medium =
      thumbs.find((t) => t.quality === "medium") ?? thumbs[thumbs.length - 1];
    return {
      id,
      title,
      artist: str(v.author, 120).replace(/ - Topic$/, ""),
      thumbnail: medium ? httpsUrl(medium.url, root) : undefined,
      duration: num(v.lengthSeconds),
    };
  };
  const songs = (items: unknown[]) =>
    items.map(song).filter((s): s is Song => !!s);
  return {
    async searchSongs(query, signal) {
      const url = `${root}/api/v1/search?${new URLSearchParams({ q: query, type: "video" })}`;
      return songs(
        list(await getJson(url, signal)).filter((v) => obj(v).type === "video"),
      );
    },
    async resolveAudio(id, signal) {
      // local=true makes the instance fetch the audio itself, so the address works for
      // this browser and not only for the instance's own network.
      const data = obj(
        await getJson(
          `${root}/api/v1/videos/${encodeURIComponent(id)}?local=true`,
          signal,
        ),
      );
      const out: AudioStream[] = [];
      for (const f of list(data.adaptiveFormats).map(obj)) {
        const mime = str(f.type, 80).split(";")[0];
        const url = httpsUrl(f.url, root);
        if (url && mime.startsWith("audio/"))
          out.push({ url, mime, bitrate: num(f.bitrate) ?? 0 });
      }
      return rankAudio(out);
    },
    embedUrl: (id) =>
      `${root}/embed/${encodeURIComponent(id)}?listen=1&autoplay=1`,
    async trending(signal) {
      return songs(
        list(await getJson(`${root}/api/v1/trending?type=music`, signal)),
      );
    },
    async playlist(playlistId, signal) {
      const data = obj(
        await getJson(
          `${root}/api/v1/playlists/${encodeURIComponent(playlistId)}`,
          signal,
        ),
      );
      return songs(list(data.videos));
    },
  };
}
