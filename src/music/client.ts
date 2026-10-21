import { AppError } from "../domain/errors";
import { musicApi } from "./api";
import { archiveMusicProvider, isArchiveId } from "./archive";
import { isAudiusId } from "./audius";
import {
  musicProviderLabels,
  SONG_ID,
  type AudioStream,
  type MusicApi,
  type MusicProvider,
  type MusicProviderType,
  type Song,
} from "./types";

// Songs are played through placeholder addresses, so a queued song does not need its audio
// address until it is its turn (the real address is short-lived).
export const musicStreamUrl = (id: string) =>
  `https://music.invalid/track/${id}`;
export function musicIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "music.invalid") return null;
    const id = u.pathname.replace(/^\/track\//, "");
    return SONG_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export class MusicUnavailableError extends AppError {
  constructor(public noProviders: boolean) {
    super(
      "network",
      noProviders
        ? "No music provider is set up. Add one in Settings → Music providers."
        : "No music provider is answering. Check the address in Settings → Music providers.",
    );
  }
}

// Providers of one family share a catalog: Invidious and Piped instances stand in for each
// other, while Audius and the Internet Archive each have their own songs.
type Family = "video" | "audius" | "archive";
const familyOf = (type: MusicProviderType): Family =>
  type === "audius" || type === "archive" ? type : "video";
const familyOfId = (id: string): Family =>
  isAudiusId(id) ? "audius" : isArchiveId(id) ? "archive" : "video";
const inFamily = (f: Family) => (p: MusicProvider) => familyOf(p.type) === f;
// A song id says which kind of service it came from, so only those are asked for its audio.
const ownedBy = (id: string) => inFamily(familyOfId(id));
const SKIP_AFTER = 3;
const SKIP_FOR = 2 * 60_000;
const RESOLVE_TTL = 10 * 60_000;

// Tries the providers in order. A provider that fails three times in a row is left out for
// two minutes (unless nothing else is left), so a dead instance does not slow every call.
// Built-in providers come after the ones set up by hand.
export class MusicClient {
  private providers: MusicProvider[] = [];
  private fails = new Map<string, { n: number; at: number }>();
  private resolved = new Map<string, { at: number; streams: AudioStream[] }>();
  constructor(
    private make: (p: MusicProvider) => MusicApi = musicApi,
    private builtIn: MusicProvider[] = [],
  ) {
    this.setProviders([]);
  }
  setProviders(list: MusicProvider[]) {
    this.providers = [...list, ...this.builtIn].filter((p) => p.enabled);
  }
  private order(only?: (p: MusicProvider) => boolean): MusicProvider[] {
    const now = Date.now();
    const pool = only ? this.providers.filter(only) : this.providers;
    const live = pool.filter((p) => {
      const f = this.fails.get(p.id);
      return !f || f.n < SKIP_AFTER || now - f.at > SKIP_FOR;
    });
    return live.length ? live : pool;
  }
  async run<T>(
    op: (api: MusicApi, provider: MusicProvider) => Promise<T>,
    signal?: AbortSignal,
    accept: (value: T) => boolean = () => true,
    only?: (p: MusicProvider) => boolean,
  ): Promise<{ value: T; provider: MusicProvider }> {
    const order = this.order(only);
    if (!order.length) throw new MusicUnavailableError(true);
    for (const provider of order) {
      try {
        const value = await op(this.make(provider), provider);
        if (!accept(value)) throw new Error("empty");
        this.fails.delete(provider.id);
        return { value, provider };
      } catch (error) {
        if (signal?.aborted) throw error;
        const f = this.fails.get(provider.id);
        this.fails.set(provider.id, { n: (f?.n ?? 0) + 1, at: Date.now() });
      }
    }
    throw new MusicUnavailableError(false);
  }
  // Asks each family at once (in turn within a family) and takes turns between their
  // answers, each song labelled with its provider. One family failing leaves the others.
  private async merged(
    op: (api: MusicApi) => Promise<Song[]>,
    signal?: AbortSignal,
  ): Promise<Song[]> {
    if (!this.providers.length) throw new MusicUnavailableError(true);
    const families = [...new Set(this.providers.map((p) => familyOf(p.type)))];
    const answers = await Promise.allSettled(
      families.map((f) =>
        this.run((api) => op(api), signal, undefined, inFamily(f)).then(
          ({ value, provider }) =>
            value.map((s) => ({
              ...s,
              source: s.source || musicProviderLabels[provider.type],
            })),
        ),
      ),
    );
    if (signal?.aborted) throw signal.reason;
    const lists = answers.flatMap((a) =>
      a.status === "fulfilled" ? [a.value] : [],
    );
    if (!lists.length) throw new MusicUnavailableError(false);
    const out: Song[] = [];
    const seen = new Set<string>();
    for (let i = 0; lists.some((l) => i < l.length); i++)
      for (const l of lists)
        if (l[i] && !seen.has(l[i].id)) {
          seen.add(l[i].id);
          out.push(l[i]);
        }
    return out;
  }
  search = (q: string, signal?: AbortSignal) =>
    this.merged((api) => api.searchSongs(q, signal), signal);
  trending = (signal?: AbortSignal): Promise<Song[]> =>
    this.merged((api) => api.trending(signal), signal);
  // Playlists come from the video and Audius services; archive items are not playlists.
  playlist = (id: string, signal?: AbortSignal) =>
    this.run(
      (api) => api.playlist(id, signal),
      signal,
      (songs) => songs.length > 0,
      (p) => p.type !== "archive",
    ).then((r) => r.value);
  // Audio streams for one song, best first, from the first provider that has any.
  async resolve(id: string, signal?: AbortSignal): Promise<AudioStream[]> {
    const hit = this.resolved.get(id);
    if (hit && Date.now() - hit.at < RESOLVE_TTL) return hit.streams;
    const { value } = await this.run(
      (api) => api.resolveAudio(id, signal),
      signal,
      (streams) => streams.length > 0,
      ownedBy(id),
    );
    this.resolved.set(id, { at: Date.now(), streams: value });
    return value;
  }
  // The player page of the first provider, for when no direct audio works.
  embedUrl(id: string): string | null {
    const first = this.order(ownedBy(id))[0];
    return first ? this.make(first).embedUrl(id) : null;
  }
  // The address the player should use for a placeholder, or the address unchanged.
  async resolveUrl(url: string, signal: AbortSignal): Promise<string> {
    const id = musicIdOf(url);
    if (!id) return url;
    const [best] = await this.resolve(id, signal);
    return best.url;
  }
}
export const musicClient = new MusicClient(musicApi, [archiveMusicProvider]);
