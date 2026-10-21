import { parseLrc, type LyricLine } from "./lrc";
import { getJson, httpsUrl, list, obj, str } from "./http";
import type { Song } from "./types";

// Two side lookups when a song starts: LRCLIB for lyrics, and MusicBrainz with the Cover
// Art Archive for the album, its art, and a line about the artist. Both are free public
// services; a miss is normal and quietly shows nothing.
export interface TrackInfo {
  synced?: LyricLine[];
  plain?: string;
  artwork?: string;
  album?: string;
  artistInfo?: string;
}

// Video titles carry decoration that would stop a lookup matching.
export function cleanTrack(song: Pick<Song, "title" | "artist">): {
  artist: string;
  title: string;
} {
  let title = song.title
    .replace(
      /[([](?:official|lyrics?|audio|video|music video|hd|hq|4k|visuali[sz]er|remaster(?:ed)?)[^)\]]*[)\]]/gi,
      "",
    )
    .replace(/\s+(?:ft\.?|feat\.?|featuring)\s.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  let artist = song.artist.trim();
  // "Artist - Title": the part before the dash is the artist.
  const dash = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(title);
  if (dash) {
    artist =
      artist && dash[1].toLowerCase().includes(artist.toLowerCase())
        ? artist
        : dash[1];
    if (!artist || dash[1].toLowerCase() === artist.toLowerCase())
      artist = dash[1];
    title = dash[2];
  }
  return { artist: artist.replace(/\s*VEVO$/i, "").trim(), title };
}

const toLyrics = (data: Record<string, unknown>) => {
  const synced =
    typeof data.syncedLyrics === "string" ? parseLrc(data.syncedLyrics) : [];
  const plain = str(data.plainLyrics, 20000)
    ? String(data.plainLyrics).slice(0, 20000)
    : undefined;
  return { synced: synced.length ? synced : undefined, plain };
};
// A looser title for the second try: no remix, version or year decoration.
const looseTitle = (title: string) =>
  title
    .replace(/[([][^)\]]*[)\]]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
export async function fetchLyrics(
  song: Song,
  signal?: AbortSignal,
): Promise<Pick<TrackInfo, "synced" | "plain">> {
  const { artist, title } = cleanTrack(song);
  if (!artist || !title) return {};
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
  });
  if (song.duration) params.set("duration", String(Math.round(song.duration)));
  try {
    const found = toLyrics(
      obj(await getJson(`https://lrclib.net/api/get?${params}`, signal, 8000)),
    );
    if (found.synced || found.plain) return found;
  } catch {
    /* No exact match: search instead. */
  }
  // The exact lookup misses when the title or length differs a little; search and take the
  // closest synced match.
  try {
    const query = new URLSearchParams({
      track_name: looseTitle(title) || title,
      artist_name: artist,
    });
    const results = list(
      await getJson(`https://lrclib.net/api/search?${query}`, signal, 8000),
    ).map(obj);
    const length = song.duration ?? 0;
    const scored = results
      .map((r) => ({
        r,
        gap:
          length && Number(r.duration)
            ? Math.abs(Number(r.duration) - length)
            : 0,
      }))
      .filter(({ gap }) => !length || gap <= 8)
      .sort(
        (a, b) =>
          Number(typeof b.r.syncedLyrics === "string") -
            Number(typeof a.r.syncedLyrics === "string") || a.gap - b.gap,
      );
    return scored.length ? toLyrics(scored[0].r) : {};
  } catch {
    return {};
  }
}
export async function fetchAlbum(
  song: Song,
  signal?: AbortSignal,
): Promise<Pick<TrackInfo, "artwork" | "album" | "artistInfo">> {
  const { artist, title } = cleanTrack(song);
  if (!artist || !title) return {};
  const quote = (s: string) => s.replace(/["\\]/g, " ");
  try {
    const query = new URLSearchParams({
      query: `recording:"${quote(title)}" AND artist:"${quote(artist)}"`,
      limit: "3",
      fmt: "json",
    });
    const found = list(
      obj(
        await getJson(
          `https://musicbrainz.org/ws/2/recording?${query}`,
          signal,
          8000,
        ),
      ).recordings,
    ).map(obj);
    const best = found.find((r) => Number(r.score) >= 80);
    if (!best) return {};
    const release = list(best.releases).map(obj)[0];
    const credit = obj(obj(list(best["artist-credit"])[0]).artist);
    const out: Pick<TrackInfo, "artwork" | "album" | "artistInfo"> = {};
    const releaseId = str(release?.id, 40);
    if (/^[0-9a-f-]{36}$/.test(releaseId)) {
      out.album = str(release.title, 200) || undefined;
      out.artwork = httpsUrl(
        `https://coverartarchive.org/release/${releaseId}/front-500`,
        "https://coverartarchive.org",
      );
    }
    const artistId = str(credit.id, 40);
    if (/^[0-9a-f-]{36}$/.test(artistId)) {
      const a = obj(
        await getJson(
          `https://musicbrainz.org/ws/2/artist/${artistId}?fmt=json`,
          signal,
          8000,
        ),
      );
      const span = obj(a["life-span"]);
      const bits = [
        str(a.type, 40),
        str(a.country, 4),
        str(span.begin, 10) ? `since ${str(span.begin, 10).slice(0, 4)}` : "",
        str(a.disambiguation, 80),
      ].filter(Boolean);
      if (bits.length) out.artistInfo = bits.join(" · ");
    }
    return out;
  } catch {
    return {};
  }
}
export async function lookUpTrack(
  song: Song,
  signal?: AbortSignal,
): Promise<TrackInfo> {
  const [lyrics, album] = await Promise.all([
    fetchLyrics(song, signal),
    fetchAlbum(song, signal),
  ]);
  return { ...lyrics, ...album };
}
