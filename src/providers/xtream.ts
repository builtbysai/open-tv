import type { Content, Source } from "../domain/content";
import { stableId, deduplicate } from "../domain/content";
import { classify } from "../domain/privacy";
import { limitedText, sourceFetch } from "./http";
import { mediaUrl, streamFormat } from "../domain/urls";
import { AppError } from "../domain/errors";
import type { EpisodicProvider } from "./contracts";
export type XtreamMode = "live" | "movie" | "series";
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function text(value: unknown, limit = 300): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
function providerId(value: unknown): string | undefined {
  return (typeof value === "string" || typeof value === "number") &&
    /^\d{1,20}$/.test(String(value))
    ? String(value)
    : undefined;
}
function integer(value: unknown, min = 0, max = 10000): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return;
  if (value === "") return;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}
function duration(info: RecordValue): number | undefined {
  const seconds = integer(info.duration_secs, 1, 86400);
  if (seconds) return seconds;
  const parts = text(info.duration).split(":");
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(parts.join(":"))) return;
  const [h, m, s] = parts.map(Number);
  return m < 60 && s < 60 && h * 3600 + m * 60 + s > 0
    ? h * 3600 + m * 60 + s
    : undefined;
}
function artwork(value: unknown): string | undefined {
  return mediaUrl(text(value, 4000)) || undefined;
}
function backdrop(value: unknown): string | undefined {
  return (Array.isArray(value) ? value : [value]).map(artwork).find(Boolean);
}
function tmdbId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
// Xtream panels send the added date as epoch seconds.
function addedAt(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 86400
    ? seconds * 1000
    : undefined;
}
function year(value: unknown): number | undefined {
  return integer(text(value).slice(0, 4), 1888, 2200);
}
export class XtreamProvider implements EpisodicProvider {
  source: Source;
  private lifetime = new AbortController();
  private episodes = new Map<string, Content[]>();
  private series = new Map<string, Content>();
  constructor(
    private base: string,
    private username: string,
    private password: string,
    private mode: XtreamMode = "live",
  ) {
    if (!mediaUrl(base))
      throw new AppError("format", "Enter a valid HTTP(S) provider address.");
    const parsed = new URL(base);
    if (parsed.search || parsed.hash)
      throw new AppError(
        "format",
        "Enter the provider server address without query parameters or fragments.",
      );
    this.base = parsed.href.replace(/\/$/, "");
    this.source = {
      id: stableId(`xtream:${this.base}:${username}:${mode}`),
      name: `Connected provider · ${mode === "live" ? "live TV" : mode === "movie" ? "movies" : "series"}`,
      kind: "xtream",
      enabled: true,
      classification: "general",
      refreshHours: 0,
      description:
        "Authorized account. Credentials and catalog remain in memory.",
    };
  }
  private async get(
    action: string,
    signal?: AbortSignal,
    parameters: Record<string, string> = {},
  ): Promise<unknown> {
    this.lifetime.signal.throwIfAborted();
    const query = new URLSearchParams({
      username: this.username,
      password: this.password,
      action,
      ...parameters,
    });
    const requestSignal = AbortSignal.any([
      this.lifetime.signal,
      ...(signal ? [signal] : []),
      AbortSignal.timeout(30000),
    ]);
    const response = await sourceFetch(`${this.base}/player_api.php?${query}`, {
      signal: requestSignal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok)
      throw new AppError(
        "authorization",
        "The provider rejected the request. Check your account and browser access.",
      );
    let value: unknown;
    try {
      value = JSON.parse(await limitedText(response));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new AppError("format", "The provider returned invalid JSON.");
      throw error;
    }
    requestSignal.throwIfAborted();
    return value;
  }
  private stream(id: string, extension: unknown) {
    const ext = /^[a-z0-9]{1,10}$/i.test(text(extension))
      ? text(extension).toLowerCase()
      : "mp4";
    const url = `${this.base}/${this.mode}/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${id}.${this.mode === "live" ? "m3u8" : ext}`;
    return { url, format: streamFormat(url) };
  }
  async load(signal?: AbortSignal): Promise<Content[]> {
    const categories = await this.get(
      this.mode === "live"
        ? "get_live_categories"
        : this.mode === "movie"
          ? "get_vod_categories"
          : "get_series_categories",
      signal,
    );
    const data = await this.get(
      this.mode === "live"
        ? "get_live_streams"
        : this.mode === "movie"
          ? "get_vod_streams"
          : "get_series",
      signal,
    );
    if (!Array.isArray(data) || !Array.isArray(categories))
      throw new AppError("format", "The provider returned an invalid catalog.");
    const categoryMap = new Map(
      categories
        .map(record)
        .filter((c) => providerId(c.category_id) && text(c.category_name))
        .map((c) => [String(c.category_id), text(c.category_name)]),
    );
    const items: Content[] = [];
    for (const raw of data) {
      const item = record(raw);
      const id = providerId(
        this.mode === "series" ? item.series_id : item.stream_id,
      );
      if (!id || !text(item.name)) continue;
      const genre = categoryMap.get(String(item.category_id)) || "Unclassified";
      items.push({
        id: stableId(`${this.source.id}:${id}`),
        providerId: this.source.id,
        providerItemId: id,
        epgId:
          this.mode === "live"
            ? text(item.epg_channel_id, 200) || undefined
            : undefined,
        title: text(item.name),
        type: this.mode,
        description: text(item.plot, 20000) || undefined,
        artwork: artwork(item.cover || item.stream_icon),
        backdrop: backdrop(item.backdrop_path),
        year: year(item.releaseDate || item.release_date),
        tmdbId: tmdbId(item.tmdb || item.tmdb_id),
        addedAt: addedAt(item.added),
        genres: [genre],
        countries: [],
        languages: [],
        classification: classify(`${text(item.name)} ${genre}`, "general"),
        // A series is discovery metadata. Only resolved episodes offer playback.
        availability: this.mode === "series" ? "unavailable" : "playable",
        streams:
          this.mode === "series"
            ? []
            : [this.stream(id, item.container_extension)],
        rights: { status: "user-authorized" },
      });
    }
    const result = deduplicate(items);
    this.series = new Map(
      result.filter((c) => c.type === "series").map((c) => [c.id, c]),
    );
    return result;
  }
  async loadEpisodes(
    series: Content,
    signal?: AbortSignal,
  ): Promise<Content[]> {
    this.lifetime.signal.throwIfAborted();
    signal?.throwIfAborted();
    const parent = this.series.get(series.id);
    if (
      this.mode !== "series" ||
      !parent ||
      series.providerId !== this.source.id
    )
      throw new AppError(
        "format",
        "Choose a series from this connected account.",
      );
    const cached = this.episodes.get(parent.id);
    if (cached) return cached;
    const response = record(
      await this.get("get_series_info", signal, {
        series_id: parent.providerItemId!,
      }),
    );
    if (!response.episodes || typeof response.episodes !== "object")
      throw new AppError(
        "format",
        "The provider did not return a valid episode list. Try again or check your account.",
      );
    const info = record(response.info);
    const items: Content[] = [];
    // Providers use either season-keyed objects or arrays. Season zero is Specials.
    for (const [key, raw] of Object.entries(response.episodes)) {
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const entry of entries) {
        const episode = record(entry),
          metadata = record(episode.info);
        const id = providerId(episode.id);
        const season = integer(episode.season) ?? integer(key);
        const number = integer(episode.episode_num, 1);
        if (!id || season === undefined || number === undefined) continue;
        const title = text(episode.title) || `Episode ${number}`;
        items.push({
          id: stableId(`${this.source.id}:episode:${id}`),
          providerId: this.source.id,
          providerItemId: id,
          title,
          type: "episode",
          seriesId: parent.id,
          season,
          episode: number,
          description: text(metadata.plot, 20000) || undefined,
          artwork: artwork(metadata.movie_image) || parent.artwork,
          backdrop: parent.backdrop,
          duration: duration(metadata),
          year: year(metadata.release_date) || parent.year,
          genres: parent.genres,
          languages: parent.languages,
          countries: parent.countries,
          classification: classify(
            `${parent.title} ${title} ${parent.genres.join(" ")} ${text(info.genre)}`,
            parent.classification,
          ),
          availability: "playable",
          streams: [this.stream(id, episode.container_extension)],
          rights: { status: "user-authorized" },
        });
      }
    }
    signal?.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    const result = deduplicate(items).sort(
      (a, b) => a.season! - b.season! || a.episode! - b.episode!,
    );
    this.episodes.set(parent.id, result);
    return result;
  }
  dispose(): void {
    this.lifetime.abort();
    this.episodes.clear();
    this.series.clear();
    this.username = "";
    this.password = "";
  }
}
