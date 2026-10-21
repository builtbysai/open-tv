import type { Content, Source } from "../domain/content";
import { clipText } from "../domain/text";
import { stableId } from "../domain/content";
import type { ContentProvider } from "./contracts";
import { limitedText, sourceFetch } from "./http";
const CHANNELS = "https://somafm.com/channels.json";
const text = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const https = (value: unknown): string | undefined => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
// A .pls file lists stream addresses as File1=, File2=, and so on.
export function parsePls(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => /^File\d+=(.+)$/i.exec(line.trim())?.[1])
    .flatMap((value) => {
      const url = https(value);
      return url ? [url] : [];
    });
}
// SomaFM: listener-supported internet radio. Channel list and streams send CORS headers,
// so the audio visualizer can read the real sound.
export class SomaFmProvider implements ContentProvider {
  source: Source;
  constructor(id = "audio-somafm", name = "SomaFM") {
    this.source = {
      id,
      name,
      kind: "directory",
      directory: { provider: "somafm" },
      classification: "general",
      enabled: true,
      description:
        "Commercial-free internet radio, supported by its listeners.",
      provenance: "https://somafm.com/support/",
      refreshHours: 24,
    };
  }
  private async get(url: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(10000);
    const response = await sourceFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`SomaFM returned ${response.status}`);
    return limitedText(response, 1_000_000);
  }
  async load(signal?: AbortSignal): Promise<Content[]> {
    const data = JSON.parse(await this.get(CHANNELS, signal)) as {
      channels?: unknown;
    };
    const channels = Array.isArray(data.channels) ? data.channels : [];
    const out: Content[] = [];
    // A handful of requests at a time: one small playlist per channel.
    const queue = channels.slice(0, 80);
    const worker = async () => {
      while (queue.length) {
        const channel = queue.shift() as Record<string, unknown>;
        const id = text(channel?.id, 60);
        const title = text(channel?.title, 120);
        if (!/^[a-z0-9_-]+$/i.test(id) || !title) continue;
        const lists = Array.isArray(channel.playlists) ? channel.playlists : [];
        const best =
          lists.find(
            (p: Record<string, unknown>) =>
              p?.format === "mp3" && p?.quality === "highest",
          ) || lists.find((p: Record<string, unknown>) => p?.format === "mp3");
        const pls = https((best as Record<string, unknown> | undefined)?.url);
        if (!pls) continue;
        try {
          // One retry: a busy moment should not drop a station from the list.
          const streams = parsePls(
            await this.get(pls, signal).catch(() => this.get(pls, signal)),
          );
          if (!streams.length) continue;
          const image =
            https(channel.xlimage) ||
            https(channel.largeimage) ||
            https(channel.image);
          out.push({
            id: stableId(`${this.source.id}:${id}`),
            providerId: this.source.id,
            providerItemId: id,
            title: `SomaFM ${title}`,
            type: "radio",
            description:
              clipText(text(channel.description, 1000), 400) || undefined,
            artwork: image,
            poster: image,
            genres: text(channel.genre, 80)
              .split("|")
              .map((g) => g.trim())
              .filter(Boolean)
              .slice(0, 3),
            languages: [],
            countries: [],
            classification: "general",
            availability: "playable",
            streams: streams
              .slice(0, 3)
              .map((url) => ({ url, format: "audio" as const })),
            externalUrl: `https://somafm.com/${id}/`,
            rights: {
              status: "provider-listed",
              attribution: "SomaFM, listener-supported radio",
              url: "https://somafm.com/support/",
            },
          });
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // Nothing at all means the service did not answer, not that it has no stations.
    if (!out.length && channels.length)
      throw new Error("SomaFM did not answer. Try again later.");
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }
}
