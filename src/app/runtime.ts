import { registry, type MediaRef } from "../core/module";
import { createMoviesModule } from "../modules/movies";
import { PlaybackSession } from "../player/session";
import { data } from "./data";

// Wires the app together: which modules exist, and how a playback is resolved, resumed and
// recorded. A new module is one more `registry.register(...)` line here.
let started = false;
export function initModules() {
  if (started) return;
  started = true;
  registry.register(
    createMoviesModule(
      { tmdbKey: () => data.tmdbKey.value, servers: () => data.servers.value, lang: () => data.lang.value },
      { base: __TMDB_BASE__, imageBase: __TMDB_IMAGE_BASE__, posterSize: window.innerWidth >= 1500 ? "w500" : "w342" },
    ),
  );
}

export const moduleOf = (ref: Pick<MediaRef, "mod">) => registry.get(ref.mod);
// Anything configured and able to show content.
export const appReady = () => registry.all().some((m) => m.ready());

// Where to resume this title, in seconds. For a show, only if the saved episode is this one.
export function startFor(ref: MediaRef): number {
  const p = data.progressOf(ref);
  if (!p || p.done || p.pending || p.t < 15) return 0;
  const same = p.ref.season === ref.season && p.ref.episode === ref.episode;
  return same ? p.t : 0;
}

export function createSession(): PlaybackSession {
  return new PlaybackSession({
    resolve: (ref, start) => moduleOf(ref)?.sources(ref, { start }) ?? [],
    next: async (ref) => {
      const m = moduleOf(ref);
      return m?.next ? m.next(ref, {}) : null;
    },
    onProgress: (ref, t, d) => data.saveProgress(ref, t, d),
    onEnded: (ref, next) => {
      data.saveProgress(ref, 1, 1); // finished: t/d is 1
      if (next) data.saveProgress(next, 0, 0, { pending: true });
    },
  });
}

// What a card or episode row should play when chosen.
export function resumeLabel(ref: MediaRef): string | null {
  const p = data.progressOf(ref);
  if (!p || p.done) return null;
  if (p.pending) return p.ref.kind === "episode" ? `Up next · S${p.ref.season} E${p.ref.episode}` : "Up next";
  if (p.t < 15) return null;
  const m = Math.floor(p.t / 60);
  const where = p.ref.kind === "episode" ? `S${p.ref.season} E${p.ref.episode} · ` : "";
  return `Resume ${where}${m}m`;
}
