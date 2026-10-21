import type { Content, Source } from "../domain/content";
import { stableId, deduplicate } from "../domain/content";
import { classify } from "../domain/privacy";
import { limitedText, sourceFetch } from "./http";
import { mediaUrl } from "../domain/urls";
import { AppError } from "../domain/errors";
import type { EpisodicProvider } from "./contracts";
export type JellyfinMode = "movie" | "series";
type RecordValue = Record<string, unknown>;
const PAGE = 2000;
const MAX_ITEMS = 5000;
const FIELDS =
  "ProviderIds,Overview,DateCreated,Genres,CommunityRating,ProductionYear,RunTimeTicks";
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function text(value: unknown, limit = 300): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
function itemId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9-]{8,40}$/i.test(value)
    ? value
    : undefined;
}
function integer(value: unknown, min = 0, max = 10000): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}
function tmdbId(value: unknown): number | undefined {
  const id =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
function addedAt(value: unknown): number | undefined {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 86400000 ? ms : undefined;
}
// RunTimeTicks are 100 ns units.
function duration(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return;
  const seconds = Math.round(value / 1e7);
  return seconds > 0 && seconds <= 86400 * 2 ? seconds : undefined;
}
function rating(value: unknown): number | undefined {
  return typeof value === "number" && value >= 0 && value <= 10
    ? value
    : undefined;
}
function genres(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((g) => text(g, 60))
        .filter(Boolean)
        .slice(0, 12)
    : [];
}
/** Jellyfin and Emby share this API family. The access token lives only in memory. */
export class JellyfinProvider implements EpisodicProvider {
  source: Source;
  private lifetime = new AbortController();
  private token = "";
  private userId = "";
  private readonly deviceId: string;
  private episodes = new Map<string, Content[]>();
  private series = new Map<string, Content>();
  constructor(
    private server: string,
    private username: string,
    private password: string,
    private mode: JellyfinMode,
    id?: string,
  ) {
    if (!mediaUrl(server))
      throw new AppError("format", "Enter a valid HTTP(S) server address.");
    const parsed = new URL(server);
    if (parsed.search || parsed.hash)
      throw new AppError(
        "format",
        "Enter the server address without query parameters or fragments.",
      );
    this.server = parsed.href.replace(/\/$/, "");
    this.deviceId = `open-tv-${crypto.randomUUID()}`;
    this.source = {
      id: id || stableId(`jellyfin:${this.server}:${username}:${mode}`),
      name: `Media server · ${mode === "movie" ? "movies" : "series"}`,
      kind: "xtream", // account-style source: in-memory credentials, never persisted
      enabled: true,
      classification: "general",
      refreshHours: 0,
      description:
        "Authorized Jellyfin or Emby account. Credentials and catalog remain in memory.",
    };
  }
  private authHeader(): string {
    return `MediaBrowser Client="Open TV", Device="Browser", DeviceId="${this.deviceId}", Version="1"`;
  }
  private async request(
    path: string,
    signal: AbortSignal | undefined,
    init: RequestInit = {},
  ): Promise<unknown> {
    this.lifetime.signal.throwIfAborted();
    const requestSignal = AbortSignal.any([
      this.lifetime.signal,
      ...(signal ? [signal] : []),
      AbortSignal.timeout(30000),
    ]);
    const headers: Record<string, string> = {
      "X-Emby-Authorization": this.authHeader(),
      Accept: "application/json",
      ...(this.token ? { "X-Emby-Token": this.token } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    };
    let response: Response;
    try {
      response = await sourceFetch(`${this.server}${path}`, {
        ...init,
        headers,
        signal: requestSignal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (this.lifetime.signal.aborted || signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new AppError(
          "network",
          "The media server took too long to respond. Try again.",
        );
      throw new AppError(
        "network",
        "Couldn’t reach the media server. Check the address, and make sure the server’s CORS settings allow this site’s origin.",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        "authorization",
        "The media server rejected the sign-in. Check your username and password.",
      );
    if (!response.ok)
      throw new AppError(
        "network",
        "The media server returned an error. Try again later.",
      );
    let value: unknown;
    try {
      value = JSON.parse(await limitedText(response));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new AppError("format", "The media server returned invalid JSON.");
      if (error instanceof AppError) throw error;
      if (requestSignal.aborted) throw requestSignal.reason;
      throw error;
    }
    requestSignal.throwIfAborted();
    return value;
  }
  private async authenticate(signal?: AbortSignal): Promise<void> {
    if (this.token && this.userId) return;
    const result = record(
      await this.request("/Users/AuthenticateByName", signal, {
        method: "POST",
        body: JSON.stringify({ Username: this.username, Pw: this.password }),
      }),
    );
    const token = text(result.AccessToken, 500);
    const uid = itemId(record(result.User).Id);
    if (!token || !uid)
      throw new AppError(
        "authorization",
        "The media server did not return a valid sign-in.",
      );
    this.token = token;
    this.userId = uid;
  }
  // Browsers cannot attach headers to media requests, so the playback URL must carry the
  // token. It has a query string, which sensitiveUrl()/persistableUrl() treat as
  // non-persistable: it never reaches storage, backups or exports.
  private stream(id: string) {
    const query = `MediaSourceId=${id}&api_key=${encodeURIComponent(this.token)}&VideoCodec=h264,hevc&AudioCodec=aac,mp3`;
    return {
      url: `${this.server}/Videos/${id}/master.m3u8?${query}`,
      format: "hls" as const,
    };
  }
  private image(id: string, kind: "Primary" | "Backdrop", width: number) {
    return `${this.server}/Items/${id}/Images/${kind}?maxWidth=${width}`;
  }
  async load(signal?: AbortSignal): Promise<Content[]> {
    await this.authenticate(signal);
    const items: Content[] = [];
    let start = 0;
    while (start < MAX_ITEMS) {
      const limit = Math.min(PAGE, MAX_ITEMS - start);
      const query = new URLSearchParams({
        Recursive: "true",
        IncludeItemTypes: this.mode === "movie" ? "Movie" : "Series",
        Fields: FIELDS,
        SortBy: "DateCreated",
        SortOrder: "Descending",
        Limit: String(limit),
        StartIndex: String(start),
      });
      const page = record(
        await this.request(`/Users/${this.userId}/Items?${query}`, signal),
      );
      if (!Array.isArray(page.Items))
        throw new AppError(
          "format",
          "The media server returned an invalid catalog.",
        );
      for (const raw of page.Items) {
        const item = record(raw);
        const id = itemId(item.Id);
        const title = text(item.Name);
        if (!id || !title) continue;
        const itemGenres = genres(item.Genres);
        items.push({
          id: stableId(`${this.source.id}:${id}`),
          providerId: this.source.id,
          providerItemId: id,
          title,
          type: this.mode,
          description: text(item.Overview, 20000) || undefined,
          artwork: this.image(id, "Primary", 500),
          backdrop: this.image(id, "Backdrop", 1280),
          year: integer(item.ProductionYear, 1888, 2200),
          rating: rating(item.CommunityRating),
          tmdbId: tmdbId(record(item.ProviderIds).Tmdb),
          addedAt: addedAt(item.DateCreated),
          duration: duration(item.RunTimeTicks),
          genres: itemGenres,
          countries: [],
          languages: [],
          classification: classify(
            `${title} ${itemGenres.join(" ")}`,
            "general",
          ),
          availability: this.mode === "series" ? "unavailable" : "playable",
          streams: this.mode === "series" ? [] : [this.stream(id)],
          rights: { status: "user-authorized" },
        });
      }
      const received = page.Items.length;
      const total = integer(page.TotalRecordCount, 0, 1e9);
      start += received;
      if (received === 0 || received < limit) break;
      if (total !== undefined && start >= total) break;
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
      series.providerId !== this.source.id ||
      !itemId(parent.providerItemId)
    )
      throw new AppError(
        "format",
        "Choose a series from this connected account.",
      );
    const cached = this.episodes.get(parent.id);
    if (cached) return cached;
    await this.authenticate(signal);
    const query = new URLSearchParams({
      UserId: this.userId,
      Fields: "Overview,RunTimeTicks,DateCreated",
    });
    const response = record(
      await this.request(
        `/Shows/${parent.providerItemId}/Episodes?${query}`,
        signal,
      ),
    );
    if (!Array.isArray(response.Items))
      throw new AppError(
        "format",
        "The media server did not return a valid episode list.",
      );
    const items: Content[] = [];
    for (const raw of response.Items.slice(0, MAX_ITEMS)) {
      const entry = record(raw);
      const id = itemId(entry.Id);
      const season = integer(entry.ParentIndexNumber) ?? 0;
      const number = integer(entry.IndexNumber, 1);
      if (!id || number === undefined) continue;
      const title = text(entry.Name) || `Episode ${number}`;
      items.push({
        id: stableId(`${this.source.id}:episode:${id}`),
        providerId: this.source.id,
        providerItemId: id,
        title,
        type: "episode",
        seriesId: parent.id,
        season,
        episode: number,
        description: text(entry.Overview, 20000) || undefined,
        artwork: this.image(id, "Primary", 500),
        backdrop: parent.backdrop,
        duration: duration(entry.RunTimeTicks),
        addedAt: addedAt(entry.DateCreated),
        year: parent.year,
        genres: parent.genres,
        languages: parent.languages,
        countries: parent.countries,
        classification: classify(
          `${parent.title} ${title} ${parent.genres.join(" ")}`,
          parent.classification,
        ),
        availability: "playable",
        streams: [this.stream(id)],
        rights: { status: "user-authorized" },
      });
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
    this.token = "";
    this.userId = "";
    this.username = "";
    this.password = "";
  }
}
