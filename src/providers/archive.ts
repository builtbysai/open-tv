/*
 * Internet Archive provider (browser-only, HTTPS, CORS-enabled endpoints).
 *
 * Contract:
 *  - load(signal) runs ONE advancedsearch query and returns lightweight items
 *    with availability "external" (externalUrl = details page) and no streams.
 *    No per-item metadata calls are made at load time.
 *  - resolve(item, signal) fetches /metadata/{id}, picks the best browser-playable
 *    file and returns a copy of the item with availability "playable" and a real
 *    stream. If no playable file exists the item is returned unchanged (external).
 *  - Movies use type "movie"; audio uses type "audio".
 */
import type { Content, Source, Stream } from "../domain/content";
import { clipText } from "../domain/text";
import { stableId } from "../domain/content";
import { classify } from "../domain/privacy";
import { AppError } from "../domain/errors";
import type { ContentProvider } from "./contracts";
import { limitedText, sourceFetch } from "./http";

export type ArchiveMediaType = "movies" | "audio";
export interface ArchiveOptions {
  collection: string;
  mediatype: ArchiveMediaType;
  name: string;
  rows?: number;
  id: string;
  // Narrows a collection to one subject, such as "film noir".
  subject?: string;
}
export interface ArchivePreset {
  collection: string;
  subject?: string;
  mediatype: ArchiveMediaType;
  id: string;
  name: string;
  description: string;
}

const ORIGIN = "https://archive.org";
const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const COLLECTION_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_VIDEO_BYTES = 1_500_000_000;
const PUBLIC_DOMAIN_COLLECTIONS = new Set([
  "feature_films",
  "classic_tv",
  "silentfilms",
  "animationandcartoons",
  "oldtimeradio",
]);

export const archiveSources: ArchivePreset[] = [
  {
    collection: "feature_films",
    mediatype: "movies",
    id: "archive-feature-films",
    name: "Internet Archive Feature Films",
    description: "Public-domain feature films from the Internet Archive.",
  },
  {
    collection: "classic_tv",
    mediatype: "movies",
    id: "archive-classic-tv",
    name: "Internet Archive Classic TV",
    description: "Vintage television programs from the Internet Archive.",
  },
  {
    collection: "SilentFilms",
    mediatype: "movies",
    id: "archive-silent-films",
    name: "Internet Archive Silent Films",
    description: "Silent-era films from the Internet Archive.",
  },
  {
    collection: "animationandcartoons",
    mediatype: "movies",
    id: "archive-cartoons",
    name: "Internet Archive Cartoons",
    description: "Classic animation and cartoons from the Internet Archive.",
  },
  {
    collection: "feature_films",
    subject: "film noir",
    mediatype: "movies",
    id: "archive-noir",
    name: "Internet Archive Film Noir",
    description: "Classic crime films from the Internet Archive.",
  },
  {
    collection: "feature_films",
    subject: "horror",
    mediatype: "movies",
    id: "archive-horror",
    name: "Internet Archive Classic Horror",
    description: "Vintage horror and monster films from the Internet Archive.",
  },
  {
    collection: "feature_films",
    subject: "western",
    mediatype: "movies",
    id: "archive-westerns",
    name: "Internet Archive Westerns",
    description: "Classic westerns from the Internet Archive.",
  },
  {
    collection: "prelinger",
    mediatype: "movies",
    id: "archive-prelinger",
    name: "Internet Archive Prelinger Archives",
    description:
      "Advertising, educational and industrial films from the Prelinger Archives.",
  },
  {
    collection: "oldtimeradio",
    mediatype: "audio",
    id: "archive-old-time-radio",
    name: "Internet Archive Old Time Radio",
    description: "Golden-age radio programs from the Internet Archive.",
  },
];

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function text(value: unknown, limit = 300): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" || typeof v === "number"
    ? String(v).trim().slice(0, limit)
    : "";
}
function stripHtml(value: string): string {
  return value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function year(value: unknown): number | undefined {
  const n = Number(text(value, 4));
  return Number.isInteger(n) && n >= 1850 && n <= 2200 ? n : undefined;
}
export function searchUrl(
  collection: string,
  mediatype: ArchiveMediaType,
  rows: number,
  subject?: string,
): string {
  const params = new URLSearchParams();
  // The subject is quoted, with quotes inside it removed, so it stays one search term.
  const topic = subject ? ` AND subject:"${subject.replace(/"/g, "")}"` : "";
  params.set(
    "q",
    `collection:${collection} AND mediatype:${mediatype}${topic}`,
  );
  for (const f of [
    "identifier",
    "title",
    "year",
    "description",
    "licenseurl",
    "downloads",
  ])
    params.append("fl[]", f);
  params.append("sort[]", "downloads desc");
  params.set("rows", String(rows));
  params.set("page", "1");
  params.set("output", "json");
  return `${ORIGIN}/advancedsearch.php?${params}`;
}

export function pickFile(
  files: unknown,
  mediatype: ArchiveMediaType,
): { name: string; format: Stream["format"] } | null {
  if (!Array.isArray(files)) return null;
  type Candidate = { name: string; rank: number; size: number };
  const candidates: Candidate[] = [];
  for (const raw of files) {
    const f = record(raw);
    const name = typeof f.name === "string" ? f.name : "";
    if (
      !name ||
      name.length > 300 ||
      name.includes("..") ||
      name.startsWith("/")
    )
      continue;
    if (f.private === true || f.private === "true") continue;
    const format = text(f.format).toLowerCase();
    const size = Number(text(f.size, 20)) || 0;
    const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
    let rank = 0;
    if (mediatype === "movies") {
      if (
        (format === "h.264" || format === "mpeg4" || ext === "mp4") &&
        ext === "mp4"
      )
        rank = size > MAX_VIDEO_BYTES ? 1 : format === "h.264" ? 6 : 5;
      else if (ext === "webm" || format === "webm") rank = 3;
      else if (ext === "ogv" || format === "ogg video") rank = 2;
    } else {
      if (ext === "mp3" && format.includes("vbr")) rank = 5;
      else if (ext === "mp3" || format.includes("mp3")) rank = 4;
      else if (ext === "ogg" || format === "ogg vorbis") rank = 2;
    }
    if (rank) candidates.push({ name, rank, size });
  }
  // Highest rank wins. Within a rank the larger file looks better, but a very large one
  // takes minutes to start, so past a size that starts quickly the smaller one wins.
  const FAST = 300_000_000;
  const preference = (size: number) =>
    size <= FAST ? size : FAST - (size - FAST);
  candidates.sort(
    (a, b) => b.rank - a.rank || preference(b.size) - preference(a.size),
  );
  const best = candidates[0];
  return best
    ? { name: best.name, format: mediatype === "audio" ? "audio" : "video" }
    : null;
}

export class ArchiveProvider implements ContentProvider {
  source: Source;
  private collection: string;
  private mediatype: ArchiveMediaType;
  private rows: number;
  private subject?: string;
  constructor(options: ArchiveOptions) {
    if (!COLLECTION_PATTERN.test(options.collection))
      throw new AppError(
        "format",
        "Enter a valid Internet Archive collection.",
      );
    if (options.mediatype !== "movies" && options.mediatype !== "audio")
      throw new AppError("format", "Unsupported Internet Archive media type.");
    this.collection = options.collection;
    this.mediatype = options.mediatype;
    this.subject = options.subject?.slice(0, 80);
    const rows = Math.floor(Number(options.rows ?? 60));
    this.rows = Number.isFinite(rows) ? Math.min(Math.max(rows, 1), 200) : 60;
    this.source = {
      id: options.id,
      name: options.name,
      kind: "catalog",
      classification: "general",
      enabled: true,
      description: `Internet Archive collection ${this.collection}.`,
      provenance: "Internet Archive public collection",
      refreshHours: 168,
    };
  }
  private async getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000);
    const response = await sourceFetch(url, {
      signal: requestSignal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new AppError(
        "network",
        `Internet Archive returned HTTP ${response.status}.`,
      );
    try {
      return JSON.parse(await limitedText(response, 5_000_000));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("format", "Internet Archive returned invalid data.");
    }
  }
  async load(signal?: AbortSignal): Promise<Content[]> {
    const json = record(
      await this.getJson(
        searchUrl(this.collection, this.mediatype, this.rows, this.subject),
        signal,
      ),
    );
    const docs = record(json.response).docs;
    if (!Array.isArray(docs))
      throw new AppError("format", "Internet Archive returned invalid data.");
    const seen = new Set<string>();
    const items: Content[] = [];
    for (const raw of docs) {
      const doc = record(raw);
      const identifier =
        typeof doc.identifier === "string" ? doc.identifier.slice(0, 101) : "";
      const title = stripHtml(text(doc.title, 600)).slice(0, 200);
      if (!ID_PATTERN.test(identifier) || !title || seen.has(identifier))
        continue;
      seen.add(identifier);
      const description = clipText(stripHtml(text(doc.description, 4000)), 500);
      const licenseUrl = text(doc.licenseurl, 500);
      // A stated license wins over the collection: a Creative Commons film in
      // "feature_films" is licensed, not public domain.
      const openLicense =
        /^https:\/\//i.test(licenseUrl) && !/publicdomain/i.test(licenseUrl);
      const publicDomain =
        !openLicense &&
        (/publicdomain/i.test(licenseUrl) ||
          PUBLIC_DOMAIN_COLLECTIONS.has(this.collection.toLowerCase()));
      const details = `${ORIGIN}/details/${identifier}`;
      const art = `${ORIGIN}/services/img/${identifier}`;
      items.push({
        // Keyed by the archive identifier alone, so a film in two collections is one title.
        id: stableId(`archive:${identifier}`),
        providerId: this.source.id,
        providerItemId: identifier,
        title,
        type: this.mediatype === "audio" ? "audio" : "movie",
        description: description || undefined,
        artwork: art,
        poster: art,
        year: year(doc.year),
        genres: [],
        languages: [],
        countries: [],
        classification: classify(`${title} ${description}`, "general"),
        availability: "external",
        streams: [],
        externalUrl: details,
        rights: {
          status: publicDomain
            ? "public-domain"
            : openLicense
              ? "open-license"
              : "unverified",
          license: /^https:\/\//i.test(licenseUrl) ? licenseUrl : undefined,
          attribution: "Internet Archive",
          url: details,
        },
      });
    }
    return items;
  }
  async resolve(item: Content, signal?: AbortSignal): Promise<Content> {
    const id = item.providerItemId || "";
    if (!ID_PATTERN.test(id))
      throw new AppError("format", "Invalid Internet Archive item.");
    const meta = record(
      await this.getJson(
        `${ORIGIN}/metadata/${encodeURIComponent(id)}`,
        signal,
      ),
    );
    const file = pickFile(meta.files, this.mediatype);
    if (!file) return item;
    const stream: Stream = {
      url: `${ORIGIN}/download/${encodeURIComponent(id)}/${file.name
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      format: file.format,
      health: "unchecked",
    };
    return { ...item, availability: "playable", streams: [stream] };
  }
}
