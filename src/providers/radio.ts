import type { Content, Source } from "../domain/content";
import { stableId } from "../domain/content";
import { classify } from "../domain/privacy";
import { normalizeCountries, normalizeLanguages } from "../domain/languages";
import type { ContentProvider } from "./contracts";
import { limitedText, sourceFetch } from "./http";
export interface RadioOptions {
  id: string;
  name: string;
  tag?: string;
  // ISO 3166-1 alpha-2 code.
  country?: string;
  limit?: number;
  description?: string;
}
export interface RadioSource {
  id: string;
  name: string;
  tag?: string;
  country?: string;
  description: string;
}
export const radioSources: RadioSource[] = [
  {
    id: "radio-top",
    name: "Top radio stations",
    description: "The most-listened stations worldwide.",
  },
  {
    id: "radio-news",
    name: "News radio",
    tag: "news",
    description: "News and talk stations.",
  },
  {
    id: "radio-jazz",
    name: "Jazz radio",
    tag: "jazz",
    description: "Jazz stations.",
  },
  {
    id: "radio-classical",
    name: "Classical radio",
    tag: "classical",
    description: "Classical music stations.",
  },
  {
    id: "radio-rock",
    name: "Rock radio",
    tag: "rock",
    description: "Rock stations.",
  },
  {
    id: "radio-electronic",
    name: "Electronic radio",
    tag: "electronic",
    description: "Electronic and dance stations.",
  },
];
const endpoint = "https://all.api.radio-browser.info/json/stations/search";
const text = (value: unknown, max: number) =>
  typeof value === "string"
    ? value

        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const https = (value: unknown, max = 2000): string | undefined => {
  if (typeof value !== "string" || value.length > max) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
const title = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase());
export class RadioBrowserProvider implements ContentProvider {
  source: Source;
  constructor(private options: RadioOptions) {
    this.source = {
      id: options.id,
      name: options.name,
      kind: "catalog",
      url: this.url(),
      classification: "general",
      enabled: true,
      description: options.description || "Public internet radio directory.",
      provenance: "Radio Browser (radio-browser.info)",
      refreshHours: 24,
    };
  }
  private url(): string {
    const query = new URLSearchParams({
      order: "clickcount",
      reverse: "true",
      hidebroken: "true",
      is_https: "true",
      limit: String(
        Math.max(1, Math.min(500, Math.floor(this.options.limit ?? 150))),
      ),
    });
    if (this.options.tag) query.set("tag", this.options.tag);
    if (this.options.country)
      query.set("countrycode", this.options.country.toUpperCase());
    return `${endpoint}?${query}`;
  }
  async load(signal?: AbortSignal): Promise<Content[]> {
    const timeout = AbortSignal.timeout(10000);
    const response = await sourceFetch(this.url(), {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new Error(`Radio directory returned ${response.status}`);
    const data: unknown = JSON.parse(await limitedText(response, 5_000_000));
    return this.parse(data);
  }
  private parse(data: unknown): Content[] {
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const out: Content[] = [];
    for (const raw of data) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const name = text(s.name, 120);
      const url = https(s.url_resolved);
      if (!name || !url) continue;
      const key = name
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const tags = text(s.tags, 500)
        .split(",")
        .map((t) => text(t, 40))
        .filter(Boolean);
      const genres = [...new Set(tags.slice(0, 3).map(title))];
      const country = text(s.countrycode, 2).toUpperCase();
      const language = text(s.language, 40);
      const hls =
        s.hls === 1 ||
        s.hls === true ||
        s.hls === "1" ||
        /\.m3u8$/i.test(new URL(url).pathname);
      const artwork = https(s.favicon, 500);
      out.push({
        id: stableId(`${this.options.id}:${String(s.stationuuid ?? key)}`),
        providerId: this.options.id,
        providerItemId: text(s.stationuuid, 64) || undefined,
        title: name,
        type: "radio",
        description: text(s.tags, 200) || undefined,
        artwork,
        poster: artwork,
        genres,
        languages: language ? normalizeLanguages([language]) : [],
        countries: country ? normalizeCountries([country]) : [],
        classification: classify(`${name} ${tags.join(" ")}`),
        availability: "playable",
        streams: [{ url, format: hls ? "hls" : "audio" }],
        externalUrl: https(s.homepage, 500),
        rights: { status: "provider-listed" },
      });
    }
    return out;
  }
}
