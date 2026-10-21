import { getJson, list, num, obj, str } from "./http";
import type { AudioStream, MusicApi, MusicProvider, Song } from "./types";

// The Internet Archive's audio collections, the Live Music Archive (etree) among them, are
// openly licensed and served as plain HTTPS files with CORS: no key, no account. That is
// why it is the one music provider built into the app. A song is a whole archive item (a
// concert or an album); it plays from its first track.
export const ARCHIVE_PREFIX = "ia_";
export const ARCHIVE_LABEL = "Internet Archive";
export const isArchiveId = (id: string) => id.startsWith(ARCHIVE_PREFIX);
const ID = /^[A-Za-z0-9._-]{1,100}$/;
const ROWS = "30";
const COLLECTIONS = "(collection:etree OR collection:opensource_audio)";
const AUDIO = "mediatype:(audio OR etree)";

export const archiveMusicProvider: MusicProvider = {
  id: "ot-builtin-archive",
  name: ARCHIVE_LABEL,
  type: "archive",
  base: "https://archive.org",
  enabled: true,
};

// Plain words only, lowercased, so nothing typed becomes search syntax (AND, quotes, *).
export const archiveTerms = (query: string) =>
  query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

// The first track of an item, as MP3 and then Ogg: the track number wins, then the name.
export function pickTracks(
  files: unknown,
): { mp3?: string; ogg?: string } | null {
  type Track = { name: string; stem: string; ext: string; n: number };
  const tracks: Track[] = [];
  for (const f of list(files).map(obj)) {
    const name = typeof f.name === "string" ? f.name : "";
    const ext = /\.(mp3|ogg)$/i.exec(name)?.[1].toLowerCase();
    if (
      !ext ||
      name.length > 300 ||
      name.includes("..") ||
      name.startsWith("/")
    )
      continue;
    if (f.private === true || f.private === "true") continue;
    // Some items ship short preview cuts next to the full tracks.
    if (/_sample\.|_64kb\.mp3$/i.test(name)) continue;
    const stem = name.slice(0, -ext.length - 1);
    tracks.push({ name, stem, ext, n: num(f.track) ?? Infinity });
  }
  if (!tracks.length) return null;
  // Ogg derivatives carry no track number, so each stem takes the number of its MP3.
  const numbered = new Map<string, number>();
  for (const t of tracks) if (Number.isFinite(t.n)) numbered.set(t.stem, t.n);
  const order = (t: Track) => numbered.get(t.stem) ?? Infinity;
  tracks.sort(
    (a, b) =>
      order(a) - order(b) ||
      a.stem.localeCompare(b.stem, undefined, { numeric: true }),
  );
  const stem = tracks[0].stem;
  const of = (ext: string) =>
    tracks.find((t) => t.stem === stem && t.ext === ext)?.name;
  return { mp3: of("mp3"), ogg: of("ogg") };
}

const download = (id: string, name: string) =>
  `https://archive.org/download/${encodeURIComponent(id)}/${name
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

// GET {base}/advancedsearch.php for songs, {base}/metadata/{id}/files for the audio.
export function archive(base = archiveMusicProvider.base): MusicApi {
  const root = base.replace(/\/+$/, "");
  const song = (raw: unknown): Song | null => {
    const d = obj(raw);
    const id = str(d.identifier, 101);
    const title = str(Array.isArray(d.title) ? d.title[0] : d.title);
    if (!ID.test(id) || !title) return null;
    const creator = Array.isArray(d.creator) ? d.creator[0] : d.creator;
    return {
      id: ARCHIVE_PREFIX + id,
      title,
      artist: str(creator, 120),
      thumbnail: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      source: ARCHIVE_LABEL,
    };
  };
  const find = async (q: string, sort: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q });
    for (const f of ["identifier", "title", "creator"])
      params.append("fl[]", f);
    params.append("sort[]", sort);
    params.set("rows", ROWS);
    params.set("output", "json");
    const docs = obj(
      obj(await getJson(`${root}/advancedsearch.php?${params}`, signal))
        .response,
    ).docs;
    const seen = new Set<string>();
    return list(docs)
      .map(song)
      .filter((s): s is Song => !!s && !seen.has(s.id) && !!seen.add(s.id));
  };
  return {
    async searchSongs(query, signal) {
      const terms = archiveTerms(query);
      if (!terms) return [];
      return find(
        `(title:(${terms}) OR creator:(${terms}) OR subject:(${terms})) AND ${COLLECTIONS} AND ${AUDIO}`,
        "downloads desc",
        signal,
      );
    },
    async resolveAudio(id, signal): Promise<AudioStream[]> {
      const item = id.slice(ARCHIVE_PREFIX.length);
      if (!isArchiveId(id) || !ID.test(item)) return [];
      const files = obj(
        await getJson(
          `${root}/metadata/${encodeURIComponent(item)}/files`,
          signal,
        ),
      ).result;
      const pick = pickTracks(files);
      const out: AudioStream[] = [];
      if (pick?.mp3)
        out.push({
          url: download(item, pick.mp3),
          mime: "audio/mpeg",
          bitrate: 0,
        });
      if (pick?.ogg)
        out.push({
          url: download(item, pick.ogg),
          mime: "audio/ogg",
          bitrate: 0,
        });
      return out;
    },
    // The files play directly, so there is no player page to fall back to.
    embedUrl: () => null,
    // The Live Music Archive's most played shows this week.
    trending: (signal) =>
      find("collection:etree AND mediatype:etree", "week desc", signal),
    // Archive items are not playlists; the client never asks it for one.
    playlist: async () => [],
  };
}
