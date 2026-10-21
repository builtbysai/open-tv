export type ContentType =
  | "live"
  | "movie"
  | "series"
  | "episode"
  | "anime"
  | "documentary"
  | "radio"
  // On-demand audio: music, podcasts, audiobooks, old-time radio.
  | "audio";
// Live stations and on-demand audio share the audio player.
export const isAudio = (item: Pick<Content, "type">) =>
  item.type === "radio" || item.type === "audio";
export type Classification = "general" | "adult" | "unknown";
export interface Stream {
  url: string;
  format: "hls" | "video" | "audio" | "embed";
  quality?: string;
  // How an embedded page is held back: open (trusted), click guard, or sandboxed.
  guard?: "open" | "click" | "sandbox";
  health?: "reachable" | "unreachable" | "unchecked";
  checkedAt?: string;
}
export interface Content {
  id: string;
  providerId: string;
  aliases?: string[];
  providerItemId?: string;
  serverId?: string;
  title: string;
  // For songs: who made it.
  artist?: string;
  type: ContentType;
  description?: string;
  artwork?: string;
  backdrop?: string;
  poster?: string;
  rating?: number;
  year?: number;
  // TMDB id supplied by the source; matches TMDB lists exactly instead of by title.
  tmdbId?: number;
  // When the source added the title, in epoch milliseconds.
  addedAt?: number;
  duration?: number;
  genres: string[];
  languages: string[];
  countries: string[];
  classification: Classification;
  availability: "playable" | "external" | "unavailable";
  streams: Stream[];
  externalUrl?: string;
  rights: {
    status:
      | "open-license"
      | "public-domain"
      | "provider-listed"
      | "user-authorized"
      | "unverified";
    license?: string;
    attribution?: string;
    url?: string;
    regions?: string[];
  };
  seriesId?: string;
  season?: number;
  episode?: number;
  epgId?: string;
}
export type DirectoryConfig =
  | {
      provider: "archive";
      collection: string;
      mediatype: "movies" | "audio";
      subject?: string;
    }
  | { provider: "radio"; tag?: string; country?: string }
  | { provider: "somafm" }
  | { provider: "nasa"; query: string };
export interface Source {
  id: string;
  name: string;
  kind: "m3u" | "catalog" | "xtream" | "library" | "directory";
  // For kind "directory": a public API that is queried instead of a file being fetched.
  directory?: DirectoryConfig;
  url?: string;
  classification: Classification;
  enabled: boolean;
  description: string;
  provenance?: string;
  refreshHours: number;
  // From an extension file rather than the app itself.
  extension?: boolean;
  // Where its titles come first when two sources list the same one. Higher goes first.
  priority?: number;
  // The playlist or catalog is carried inside the extension, not fetched from `url`.
  inline?: boolean;
}
export interface CatalogSnapshot {
  version: 1;
  generatedAt: string;
  items: Content[];
  sources: Source[];
}
// A stable opaque key, not an encryption mechanism. Never log or store the input URL.
export function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let second = 5381;
  for (let i = value.length - 1; i >= 0; i--)
    second = Math.imul(second, 33) ^ value.charCodeAt(i);
  return `ot-${(hash >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
// The same film listed in two Internet Archive collections (or as "Series: Title" and
// "Title") is one title. Only archive listings with a known year are matched this way, so
// similar names from other sources stay distinct.
function archiveKey(item: Content): string | undefined {
  if (item.rights?.attribution !== "Internet Archive" || !item.year) return;
  const bare = item.title.replace(/^[^:]{1,24}:\s+/, "");
  const key = bare
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return key ? `${item.type}:${item.year}:${key}` : undefined;
}
export function deduplicate(items: Content[]): Content[] {
  const out = new Map<string, Content>();
  const urls = new Map<string, Content>();
  const archive = new Map<string, Content>();
  for (const item of items) {
    const prior =
      out.get(item.id) ||
      item.streams
        .map((s) => urls.get(`${item.type}:${s.url}`))
        .find(Boolean) ||
      archive.get(archiveKey(item) ?? "");
    if (!prior) {
      const copy = {
        ...item,
        streams: [...item.streams],
        aliases: [...(item.aliases || [])],
      };
      out.set(item.id, copy);
      const key = archiveKey(item);
      if (key) archive.set(key, copy);
      for (const stream of item.streams)
        urls.set(`${item.type}:${stream.url}`, copy);
      continue;
    }
    prior.aliases = [
      ...new Set([...(prior.aliases || []), item.id, ...(item.aliases || [])]),
    ];
    // Match exact URLs or exact provider IDs only. Similar names remain distinct.
    for (const stream of item.streams) {
      if (!prior.streams.some((s) => s.url === stream.url))
        prior.streams.push(stream);
      urls.set(`${item.type}:${stream.url}`, prior);
    }
    if (!prior.artwork && item.artwork) prior.artwork = item.artwork;
    if (item.classification !== "general")
      prior.classification = item.classification;
  }
  return [...out.values()];
}
