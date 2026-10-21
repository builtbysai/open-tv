import { limitedText } from "./http";
export interface TvMazeShow {
  tvmazeId: number;
  title: string;
  year?: number;
  overview: string;
  poster?: string;
  backdrop?: string;
  rating?: number;
  genres: string[];
  imdb?: string;
}
export interface TvMazeEpisode {
  season: number;
  number: number;
  name: string;
  summary: string;
  airdate?: string;
  runtime?: number;
  image?: string;
}
const base = "https://api.tvmaze.com";
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export function stripHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code =
          e[1].toLowerCase() === "x"
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return entities[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}
const https = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.replace(/^http:\/\//i, "https://"));
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
function show(raw: unknown): TvMazeShow | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const id = num(s.id);
  const title = typeof s.name === "string" ? s.name.trim().slice(0, 200) : "";
  if (!id || !title) return null;
  const img = (s.image ?? {}) as Record<string, unknown>;
  const rating = num(((s.rating ?? {}) as Record<string, unknown>).average);
  const year = Number.parseInt(String(s.premiered ?? "").slice(0, 4), 10);
  const imdb = ((s.externals ?? {}) as Record<string, unknown>).imdb;
  return {
    tvmazeId: id,
    title,
    year: Number.isFinite(year) ? year : undefined,
    overview: stripHtml(s.summary),
    poster: https(img.medium),
    backdrop: https(img.original),
    rating,
    genres: Array.isArray(s.genres)
      ? s.genres.filter((g): g is string => typeof g === "string").slice(0, 5)
      : [],
    imdb: typeof imdb === "string" && /^tt\d+$/.test(imdb) ? imdb : undefined,
  };
}
// TVmaze allows roughly 20 calls per 10 seconds; space calls to stay under that.
export class TvMazeProvider {
  private last = 0;
  constructor(private minGapMs = 500) {}
  private async throttle(signal?: AbortSignal) {
    const wait = this.last + this.minGapMs - Date.now();
    this.last = Math.max(Date.now(), this.last + this.minGapMs);
    if (wait > 0)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
  }
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    await this.throttle(signal);
    const timeout = AbortSignal.timeout(8000);
    const response = await fetch(`${base}${path}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 429) throw new Error("rate-limited");
    if (!response.ok) throw new Error(`TVmaze returned ${response.status}`);
    return JSON.parse(await limitedText(response, 3_000_000));
  }
  async trending(signal?: AbortSignal): Promise<TvMazeShow[]> {
    const date = new Date().toISOString().slice(0, 10);
    const web = await this.get(`/schedule/web?date=${date}`, signal);
    const tv = await this.get(`/schedule?country=US&date=${date}`, signal);
    const seen = new Set<number>();
    const out: TvMazeShow[] = [];
    for (const entry of [
      ...(Array.isArray(web) ? web : []),
      ...(Array.isArray(tv) ? tv : []),
    ]) {
      const e = entry as Record<string, unknown> | null;
      const raw =
        (e?._embedded as Record<string, unknown> | undefined)?.show ?? e?.show;
      const item = show(raw);
      if (!item || seen.has(item.tvmazeId)) continue;
      if (item.rating === undefined || !item.poster) continue;
      seen.add(item.tvmazeId);
      out.push(item);
    }
    return out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 40);
  }
  async search(query: string, signal?: AbortSignal): Promise<TvMazeShow[]> {
    const q = query.trim();
    if (!q) return [];
    const data = await this.get(
      `/search/shows?${new URLSearchParams({ q })}`,
      signal,
    );
    if (!Array.isArray(data)) return [];
    return data
      .map((r) => show((r as Record<string, unknown> | null)?.show))
      .filter((s): s is TvMazeShow => !!s);
  }
  async episodes(
    tvmazeId: number,
    signal?: AbortSignal,
  ): Promise<TvMazeEpisode[]> {
    if (!Number.isInteger(tvmazeId) || tvmazeId <= 0) return [];
    const data = await this.get(`/shows/${tvmazeId}/episodes`, signal);
    if (!Array.isArray(data)) return [];
    const out: TvMazeEpisode[] = [];
    for (const raw of data) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const season = num(e.season),
        number = num(e.number);
      if (season === undefined || number === undefined) continue;
      out.push({
        season,
        number,
        name: typeof e.name === "string" ? e.name.slice(0, 200) : "",
        summary: stripHtml(e.summary),
        airdate:
          typeof e.airdate === "string" && e.airdate ? e.airdate : undefined,
        runtime: num(e.runtime),
        image: https(((e.image ?? {}) as Record<string, unknown>).medium),
      });
    }
    return out;
  }
}
