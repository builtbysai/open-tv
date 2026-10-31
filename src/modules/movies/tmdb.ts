import type { Details, MediaRef, Season } from "../../core/module";
import { timeoutSignal } from "../../core/env";

// A small TMDB client. Accepts a v3 API key or a v4 read-access token. Adult titles are
// excluded at the request and again when mapping, and nothing here sends anything about the
// person: only the key, the title ids and a language.

export type TmdbFailure = "auth" | "rate" | "network" | "http";
export class TmdbError extends Error {
  constructor(public kind: TmdbFailure, message: string) {
    super(message);
  }
}

const GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
  10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

export interface TmdbConfig {
  key: string;
  base: string;
  imageBase: string;
  lang: string;
  // Poster width: a bigger one on 4K screens.
  posterSize?: "w342" | "w500";
}

type Json = Record<string, unknown>;
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const IMG = /^\/[A-Za-z0-9._-]+\.(?:jpg|png|webp)$/;

export class Tmdb {
  private cache = new Map<string, { at: number; value: unknown }>();
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private cfg: TmdbConfig) {}

  private image(path: unknown, size: string): string | undefined {
    return typeof path === "string" && IMG.test(path) ? `${this.cfg.imageBase}/${size}${path}` : undefined;
  }

  private async fetchJson(path: string, params: Record<string, string>, signal?: AbortSignal, retry = true): Promise<Json> {
    const query = new URLSearchParams({ include_adult: "false", language: this.cfg.lang, ...params });
    const bearer = this.cfg.key.startsWith("eyJ");
    if (!bearer) query.set("api_key", this.cfg.key);
    let response: Response;
    try {
      response = await fetch(`${this.cfg.base}/${path}?${query}`, {
        signal: timeoutSignal(10000, signal),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: bearer ? { Authorization: `Bearer ${this.cfg.key}` } : undefined,
      });
    } catch {
      throw new TmdbError("network", "Could not reach TMDB.");
    }
    if (response.status === 401) throw new TmdbError("auth", "TMDB rejected the key.");
    if (response.status === 429 && retry) {
      const wait = Math.min(5, Number(response.headers.get("Retry-After")) || 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.fetchJson(path, params, signal, false);
    }
    if (response.status === 429) throw new TmdbError("rate", "TMDB is busy. Try again in a moment.");
    if (!response.ok) throw new TmdbError("http", `TMDB answered ${response.status}.`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new TmdbError("http", "Unexpectedly large answer.");
    return JSON.parse(text) as Json;
  }

  // Cached for ten minutes, and identical requests in flight share one answer.
  private get(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<Json> {
    const key = path + "?" + JSON.stringify(params);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit.value as Json);
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<Json>;
    const request = this.fetchJson(path, params, signal)
      .then((value) => {
        this.cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  // Is this key accepted? Used by the phone's setup before saving it.
  async verify(signal?: AbortSignal): Promise<"ok" | TmdbFailure> {
    try {
      await this.fetchJson("configuration", {}, signal, false);
      return "ok";
    } catch (e) {
      return e instanceof TmdbError ? e.kind : "network";
    }
  }

  map(raw: Json, hint?: "movie" | "tv"): MediaRef | null {
    const type = raw.media_type === "movie" || raw.media_type === "tv" ? raw.media_type : hint;
    if (!type || raw.adult === true || typeof raw.id !== "number") return null;
    const title = str(type === "movie" ? raw.title : raw.name, 200);
    if (!title) return null;
    const date = str(type === "movie" ? raw.release_date : raw.first_air_date, 10);
    const year = Number(date.slice(0, 4));
    const ref: MediaRef = { mod: "movies", kind: type, id: String(raw.id), title };
    if (year > 1800) ref.year = year;
    const overview = str(raw.overview, 1200);
    if (overview) ref.overview = overview;
    const poster = this.image(raw.poster_path, this.cfg.posterSize ?? "w342");
    if (poster) ref.poster = poster;
    const backdrop = this.image(raw.backdrop_path, "w1280");
    if (backdrop) ref.backdrop = backdrop;
    const rating = num(raw.vote_average);
    if (rating && rating > 0) ref.rating = Math.round(rating * 10) / 10;
    return ref;
  }

  private list(data: Json, hint?: "movie" | "tv", limit = 20): MediaRef[] {
    const results = Array.isArray(data.results) ? (data.results as Json[]) : [];
    const out: MediaRef[] = [];
    for (const r of results) {
      const ref = r && typeof r === "object" ? this.map(r, hint) : null;
      if (ref && !out.some((o) => o.kind === ref.kind && o.id === ref.id)) out.push(ref);
      if (out.length >= limit) break;
    }
    return out;
  }

  async trending(kind: "movie" | "tv", signal?: AbortSignal) {
    return this.list(await this.get(`trending/${kind}/week`, {}, signal), kind);
  }
  async browse(kind: "movie" | "tv", list: string, signal?: AbortSignal) {
    return this.list(await this.get(`${kind}/${list}`, {}, signal), kind);
  }
  async genre(kind: "movie" | "tv", genre: number, signal?: AbortSignal) {
    return this.list(
      await this.get(`discover/${kind}`, { with_genres: String(genre), sort_by: "popularity.desc", "vote_count.gte": "100" }, signal),
      kind,
    );
  }
  async search(query: string, signal?: AbortSignal): Promise<MediaRef[]> {
    const data = await this.get("search/multi", { query: query.slice(0, 100) }, signal);
    // multi search also returns people; map() drops anything that is not a movie or show.
    return this.list(data, undefined, 30);
  }

  async details(ref: MediaRef, signal?: AbortSignal): Promise<Details> {
    const kind = ref.kind === "episode" ? "tv" : ref.kind;
    const d = await this.get(`${kind}/${ref.id}`, { append_to_response: "credits,recommendations" }, signal);
    const base = this.map(d, kind as "movie" | "tv") ?? ref;
    const runtime = num(d.runtime) ?? (Array.isArray(d.episode_run_time) ? num(d.episode_run_time[0]) : undefined);
    const facts: string[] = [];
    if (base.year) facts.push(String(base.year));
    if (kind === "movie" && runtime) facts.push(`${Math.floor(runtime / 60)}h ${runtime % 60}m`);
    const seasons =
      kind === "tv" && Array.isArray(d.seasons)
        ? (d.seasons as Json[])
            .filter((s) => Number.isInteger(s.season_number) && (num(s.episode_count) ?? 0) > 0)
            .map((s) => ({
              number: s.season_number as number,
              name: str(s.name, 80) || `Season ${s.season_number}`,
              count: num(s.episode_count) ?? 0,
            }))
            .sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number))
        : undefined;
    if (kind === "tv" && seasons) {
      const regular = seasons.filter((s) => s.number > 0).length;
      if (regular) facts.push(`${regular} season${regular === 1 ? "" : "s"}`);
    }
    const credits = (d.credits ?? {}) as Json;
    const cast = Array.isArray(credits.cast)
      ? (credits.cast as Json[]).slice(0, 8).map((c) => str(c.name, 80)).filter(Boolean)
      : [];
    const genres = Array.isArray(d.genres)
      ? (d.genres as Json[]).map((g) => str(g.name, 40)).filter(Boolean)
      : Array.isArray(d.genre_ids)
        ? (d.genre_ids as number[]).map((id) => GENRES[id]).filter(Boolean)
        : [];
    const recs = (d.recommendations ?? {}) as Json;
    return {
      ref: { ...ref, ...base, kind: kind as string },
      facts,
      genres,
      cast,
      tagline: str(d.tagline, 200) || undefined,
      seasons,
      related: this.list(recs, kind as "movie" | "tv", 12),
    };
  }

  async season(show: MediaRef, number: number, signal?: AbortSignal): Promise<Season> {
    const d = await this.get(`tv/${show.id}/season/${number}`, {}, signal);
    const eps = Array.isArray(d.episodes) ? (d.episodes as Json[]) : [];
    return {
      number,
      name: str(d.name, 80) || (number === 0 ? "Specials" : `Season ${number}`),
      episodes: this.episodes(show, number, eps),
    };
  }

  private episodes(show: MediaRef, number: number, eps: Json[]): MediaRef[] {
    const out: MediaRef[] = [];
    for (const e of eps) {
      const n = e.episode_number;
      if (!Number.isInteger(n) || (n as number) < 1) continue;
      const ref: MediaRef = {
        mod: "movies",
        kind: "episode",
        id: show.id,
        title: show.title,
        season: number,
        episode: n as number,
        epTitle: str(e.name, 200) || `Episode ${n}`,
      };
      const overview = str(e.overview, 600);
      if (overview) ref.overview = overview;
      const still = this.image(e.still_path, "w300");
      if (still) ref.poster = still;
      else if (show.poster) ref.poster = show.poster;
      const year = Number(str(e.air_date, 10).slice(0, 4));
      if (year > 1800) ref.year = year;
      out.push(ref);
    }
    return out;
  }
}
