import { normalizeCountries, normalizeLanguages } from "../domain/languages";
import { stableId, type Content, type Source } from "../domain/content";
import { classify } from "../domain/privacy";
import { mediaUrl, streamFormat } from "../domain/urls";
import { AppError } from "../domain/errors";
import { limitedText, sourceFetch } from "./http";
import type { ContentProvider } from "./contracts";
export function parseM3U(text: string, source: Source): Content[] {
  if (!text.trimStart().startsWith("#EXTM3U"))
    throw new AppError("format", "This file is not an extended M3U playlist.");
  const items: Content[] = [];
  let info: string | null = null;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const value = line.trim();
    if (value.startsWith("#EXTINF:")) {
      info = value;
      continue;
    }
    if (!value || value.startsWith("#")) continue;
    if (!info) continue;
    const attrs = Object.fromEntries(
      [...info.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => [
        m[1],
        m[2] ?? m[3],
      ]),
    );
    // Find the first comma outside attribute quotes; titles can themselves contain commas.
    let quote = "",
      split = -1;
    for (let i = 0; i < info.length; i++) {
      const c = info[i];
      if (c === '"' || c === "'") {
        if (c === quote) quote = "";
        else if (!quote) quote = c;
      } else if (c === "," && !quote) {
        split = i;
        break;
      }
    }
    const title =
      (split >= 0 ? info.slice(split + 1) : attrs["tvg-name"])?.trim() ||
      "Untitled";
    const url = mediaUrl(value, source.url);
    info = null;
    if (!url) continue;
    const genres = (attrs["group-title"] || "Other")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    // radio="true" marks an audio station whose address has no file extension.
    const format = attrs["radio"] === "true" ? "audio" : streamFormat(url);
    const type =
      source.id === "classic-films" ||
      (format === "video" && /\.(mp4|webm|mkv)(\?|$)/i.test(url))
        ? "movie"
        : format === "audio"
          ? "radio"
          : "live";
    const providerItemId = attrs["tvg-id"] || undefined;
    items.push({
      id: providerItemId
        ? stableId(`${source.id}:${providerItemId}`)
        : stableId(url),
      providerId: source.id,
      providerItemId,
      title,
      type,
      artwork: attrs["tvg-logo"]
        ? mediaUrl(attrs["tvg-logo"]) || undefined
        : undefined,
      genres,
      languages: normalizeLanguages([attrs["tvg-language"] || ""]),
      countries: normalizeCountries([attrs["tvg-country"] || ""]),
      classification: classify(
        `${title} ${genres.join(" ")} ${url}`,
        source.classification,
      ),
      availability: "playable",
      streams: [{ url, format, health: "unchecked" }],
      rights: {
        status:
          source.id === "classic-films"
            ? "unverified"
            : source.kind === "library"
              ? "user-authorized"
              : "provider-listed",
        url: source.provenance,
      },
      epgId: providerItemId,
    });
  }
  return items;
}
export class M3UProvider implements ContentProvider {
  constructor(public source: Source) {}
  async load(signal?: AbortSignal): Promise<Content[]> {
    const response = await sourceFetch(this.source.url!, {
      signal,
      referrerPolicy: "no-referrer",
      credentials: "omit",
    });
    if (!response.ok)
      throw new AppError(
        "network",
        "The playlist server could not be reached. It may restrict your region or browser.",
      );
    const text = await limitedText(response);
    if (text.length > 15_000_000)
      throw new AppError(
        "format",
        "This playlist exceeds the 15 MB import limit. Split it into smaller playlists.",
      );
    return parseM3U(text, this.source);
  }
}
