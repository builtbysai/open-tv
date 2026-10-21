import type { Content, Source } from "../domain/content";
import { clipText } from "../domain/text";
import { stableId } from "../domain/content";
import { classify } from "../domain/privacy";
import { AppError } from "../domain/errors";
import type { ContentProvider } from "./contracts";
import { limitedText, sourceFetch } from "./http";
// NASA Image and Video Library: public-domain footage, no key, CORS-open. A listing
// carries no file; resolve() looks up the video file when a title is opened.
const API = "https://images-api.nasa.gov";
const ID = /^[A-Za-z0-9._~-]{1,200}$/;
export interface NasaPreset {
  id: string;
  name: string;
  query: string;
  description: string;
}
export const nasaSources: NasaPreset[] = [
  {
    id: "nasa-apollo",
    name: "NASA · Apollo",
    query: "apollo",
    description: "Apollo-era mission footage and documentaries.",
  },
  {
    id: "nasa-space",
    name: "NASA · Space exploration",
    query: "space exploration",
    description: "Missions, telescopes and rovers.",
  },
  {
    id: "nasa-earth",
    name: "NASA · Earth from space",
    query: "earth observation",
    description: "Our planet as seen from orbit.",
  },
];
const text = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")

        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
// The library lists files over http; the same paths work over https.
const secure = (value: unknown): string | undefined => {
  try {
    const url = new URL(String(value).replace(/^http:/, "https:"));
    return url.protocol === "https:" &&
      /(^|\.)nasa\.gov$/.test(url.hostname) &&
      !url.username
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
// Prefer a mid-size rendition: sharp enough for a TV, small enough to start quickly.
const rank = [
  "~medium.mp4",
  "~large.mp4",
  "~small.mp4",
  "~mobile.mp4",
  "~orig.mp4",
];
export function pickVideo(files: unknown): string | undefined {
  const urls = (Array.isArray(files) ? files : [])
    .map((f: { href?: unknown }) => secure(f?.href))
    .filter((u): u is string => !!u);
  for (const suffix of rank) {
    const found = urls.find((u) => u.toLowerCase().endsWith(suffix));
    if (found) return found;
  }
  return urls.find((u) => /\.mp4$/i.test(u));
}
export class NasaProvider implements ContentProvider {
  source: Source;
  constructor(
    private options: { id: string; name: string; query: string; rows?: number },
  ) {
    this.source = {
      id: options.id,
      name: options.name,
      kind: "directory",
      directory: { provider: "nasa", query: options.query },
      classification: "general",
      enabled: true,
      description: "NASA Image and Video Library.",
      provenance: "https://images.nasa.gov/",
      refreshHours: 168,
    };
  }
  private async json(url: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(20000);
    const response = await sourceFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new AppError("network", "NASA's library is unavailable right now.");
    return JSON.parse(await limitedText(response, 5_000_000));
  }
  async load(signal?: AbortSignal): Promise<Content[]> {
    const rows = Math.min(Math.max(this.options.rows ?? 60, 1), 100);
    const query = new URLSearchParams({
      q: this.options.query,
      media_type: "video",
      page_size: String(rows),
    });
    const data = (await this.json(`${API}/search?${query}`, signal)) as {
      collection?: { items?: unknown };
    };
    const items = Array.isArray(data.collection?.items)
      ? (data.collection!.items as Record<string, unknown>[])
      : [];
    const out: Content[] = [];
    for (const entry of items) {
      const meta = (Array.isArray(entry.data) ? entry.data[0] : null) as Record<
        string,
        unknown
      > | null;
      const id = text(meta?.nasa_id, 200);
      const title = text(meta?.title, 200);
      if (!ID.test(id) || !title) continue;
      const links = Array.isArray(entry.links)
        ? (entry.links as { href?: unknown }[])
        : [];
      const image = secure(links[0]?.href);
      const year = Number(text(meta?.date_created, 4));
      const description = clipText(text(meta?.description, 3000), 1200);
      out.push({
        id: stableId(`nasa:${id}`),
        providerId: this.source.id,
        providerItemId: id,
        title,
        type: "documentary",
        description: description || undefined,
        artwork: image,
        poster: image,
        year: year > 1900 ? year : undefined,
        genres: ["Space", "Documentary"],
        languages: ["English"],
        countries: ["US"],
        classification: classify(`${title} ${description}`, "general"),
        availability: "external",
        streams: [],
        externalUrl: `https://images.nasa.gov/details/${encodeURIComponent(id)}`,
        rights: {
          status: "public-domain",
          attribution: "NASA",
          url: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        },
      });
    }
    return out;
  }
  async resolve(item: Content, signal?: AbortSignal): Promise<Content> {
    const id = item.providerItemId || "";
    if (!ID.test(id))
      throw new AppError(
        "format",
        "This NASA listing has an invalid identifier.",
      );
    const data = (await this.json(
      `${API}/asset/${encodeURIComponent(id)}`,
      signal,
    )) as { collection?: { items?: unknown } };
    const url = pickVideo(data.collection?.items);
    if (!url) return item;
    return {
      ...item,
      availability: "playable",
      streams: [{ url, format: "video" }],
    };
  }
}
