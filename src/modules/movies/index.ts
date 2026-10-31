import type { AppModule, MediaRef, PlaySource, Rail } from "../../core/module";
import { Tmdb, type TmdbConfig } from "./tmdb";
import { embedUrl, byOrder, type Server } from "./servers";

// TMDB for what exists, your own servers for what plays. This is the first module and the
// template for the rest: everything it needs from the app arrives through `settings`, and
// everything it gives back is a MediaRef, a Rail or a PlaySource.
export interface MoviesSettings {
  tmdbKey(): string;
  servers(): Server[];
  lang(): string;
}

export const MOVIES = "movies";

export function createMoviesModule(
  settings: MoviesSettings,
  tmdbConfig: Pick<TmdbConfig, "base" | "imageBase" | "posterSize">,
): AppModule {
  let client: { key: string; lang: string; tmdb: Tmdb } | null = null;
  // One client per key and language, so its cache survives between screens.
  const tmdb = (): Tmdb => {
    const key = settings.tmdbKey();
    const lang = settings.lang();
    if (!client || client.key !== key || client.lang !== lang)
      client = { key, lang, tmdb: new Tmdb({ ...tmdbConfig, key, lang }) };
    return client.tmdb;
  };
  const enabled = () => settings.servers().filter((s) => s.enabled).sort(byOrder);

  const rail = (id: string, title: string, load: Promise<MediaRef[]>): Promise<Rail | null> =>
    // One failing rail must not blank the screen; an auth failure is thrown once below.
    load.then((items) => (items.length ? { id, title, items } : null));

  async function rails(section: string, ctx: { signal?: AbortSignal }): Promise<Rail[]> {
    const t = tmdb();
    const s = ctx.signal;
    const jobs: Promise<Rail | null>[] =
      section === "movies"
        ? [
            rail("m-pop", "Popular movies", t.browse("movie", "popular", s)),
            rail("m-top", "Top rated", t.browse("movie", "top_rated", s)),
            rail("m-now", "In theaters", t.browse("movie", "now_playing", s)),
            rail("m-act", "Action", t.genre("movie", 28, s)),
            rail("m-com", "Comedy", t.genre("movie", 35, s)),
            rail("m-sci", "Science fiction", t.genre("movie", 878, s)),
            rail("m-ani", "Animation", t.genre("movie", 16, s)),
            rail("m-doc", "Documentaries", t.genre("movie", 99, s)),
          ]
        : section === "tv"
          ? [
              rail("t-pop", "Popular shows", t.browse("tv", "popular", s)),
              rail("t-top", "Top rated", t.browse("tv", "top_rated", s)),
              rail("t-air", "On the air", t.browse("tv", "on_the_air", s)),
              rail("t-dra", "Drama", t.genre("tv", 18, s)),
              rail("t-com", "Comedy", t.genre("tv", 35, s)),
              rail("t-sci", "Sci-Fi & Fantasy", t.genre("tv", 10765, s)),
              rail("t-cri", "Crime", t.genre("tv", 80, s)),
              rail("t-ani", "Animation", t.genre("tv", 16, s)),
            ]
          : [
              rail("trend-m", "Trending movies", t.trending("movie", s)),
              rail("trend-t", "Trending shows", t.trending("tv", s)),
              rail("m-pop", "Popular movies", t.browse("movie", "popular", s)),
              rail("t-pop", "Popular shows", t.browse("tv", "popular", s)),
              rail("m-top", "Top rated movies", t.browse("movie", "top_rated", s)),
              rail("t-top", "Top rated shows", t.browse("tv", "top_rated", s)),
              rail("m-act", "Action", t.genre("movie", 28, s)),
              rail("m-com", "Comedy", t.genre("movie", 35, s)),
            ];
    // Rails load together; the ones that failed are left out, unless all of them did.
    const settled = await Promise.all(jobs.map((j) => j.then((r) => ({ r }), (error: unknown) => ({ error }))));
    const ok: Rail[] = [];
    for (const x of settled) if ("r" in x && x.r) ok.push(x.r);
    if (!ok.length) {
      const failed = settled.find((x): x is { error: unknown } => "error" in x);
      if (failed) throw failed.error;
    }
    return ok;
  }

  return {
    id: MOVIES,
    label: "Movies & TV",
    sections: [
      { id: "movies", label: "Movies" },
      { id: "tv", label: "TV Shows" },
    ],
    // Needs the TMDB key to browse, and a server to play from.
    ready: () => !!settings.tmdbKey() && enabled().length > 0,
    rails,
    search: (query, ctx) => tmdb().search(query, ctx.signal),
    details: (ref, ctx) => tmdb().details(ref, ctx.signal),
    episodes: (ref, season, ctx) => tmdb().season(ref, season, ctx.signal),

    sources(ref, opts): PlaySource[] {
      const out: PlaySource[] = [];
      for (const server of enabled()) {
        const url =
          ref.kind === "movie"
            ? embedUrl(server, { kind: "movie", id: ref.id, start: opts.start })
            : ref.kind === "episode" && ref.season !== undefined && ref.episode !== undefined
              ? embedUrl(server, { kind: "episode", id: ref.id, season: ref.season, episode: ref.episode, start: opts.start })
              : null;
        if (url)
          out.push({ type: "embed", id: server.id, label: server.name, url, sandbox: server.sandbox, bridge: server.bridge });
      }
      return out;
    },

    async next(ref, ctx) {
      if (ref.kind !== "episode" || ref.season === undefined || ref.episode === undefined) return null;
      const t = tmdb();
      const current = await t.season(ref, ref.season, ctx.signal);
      const after = current.episodes.find((e) => e.episode === ref.episode! + 1);
      if (after) return after;
      if (ref.season === 0) return null; // Specials do not lead into a season.
      const info = await t.details({ ...ref, kind: "tv" }, ctx.signal);
      const following = (info.seasons ?? []).find((s) => s.number > ref.season! && s.number > 0);
      if (!following) return null;
      const season = await t.season(ref, following.number, ctx.signal);
      return season.episodes[0] ?? null;
    },
  };
}
