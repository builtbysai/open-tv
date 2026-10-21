import type { Content } from "../domain/content";
import {
  libraryContent,
  probeServer,
  type Kind,
  type Seed,
} from "../domain/embed-library";
import { serverAddress, type MediaServer } from "../domain/servers";
const SLOT = "opentv:embed-library:v1";
const FAILS = "opentv:embed-failures:v1";
// A server is forgiven a week after its last failure.
const FAIL_TTL = 7 * 24 * 3600 * 1000;
const TTL = 24 * 3600 * 1000;
const CONCURRENCY = 4;
interface Entry {
  seed: Seed;
  at: number;
  // Results are per server address, so editing a server re-checks it.
  found: string[];
  missing: string[];
}
const entryKey = (kind: Kind, id: number) => `${kind}:${id}`;
const serverKey = (server: MediaServer) => `${server.id}|${server.base}`;
// Checks which TMDB titles your servers have, by asking each server for the title's
// embed page. Results are remembered for a day so a restart does not ask again.
export class ServerLibrary {
  private servers: MediaServer[] = [];
  private entries = new Map<string, Entry>();
  // How often each server failed to return a title when opened; fewer failures come first.
  private failures = new Map<string, { n: number; at: number }>();
  private queue: (() => Promise<void>)[] = [];
  private pending = new Set<string>();
  private running = 0;
  private listeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: { version: number; items: Content[] } = {
    version: -1,
    items: [],
  };
  constructor(private storage?: Pick<Storage, "getItem" | "setItem">) {
    try {
      const saved = JSON.parse(storage?.getItem(SLOT) || "[]");
      const now = Date.now();
      for (const entry of Array.isArray(saved) ? saved : [])
        if (entry?.seed?.tmdbId && now - entry.at < TTL)
          this.entries.set(entryKey(entry.seed.kind, entry.seed.tmdbId), {
            seed: entry.seed,
            at: entry.at,
            found: entry.found || [],
            missing: entry.missing || [],
          });
      const fails = JSON.parse(storage?.getItem(FAILS) || "{}");
      for (const [key, f] of Object.entries(fails || {})) {
        const r = f as { n?: number; at?: number };
        if (r?.n && r.at && Date.now() - r.at < FAIL_TTL)
          this.failures.set(key, { n: r.n, at: r.at });
      }
    } catch {
      /* Start with an empty cache. */
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;
  setServers(servers: MediaServer[]) {
    const usable = servers.filter(
      (s) => s.enabled && s.classification === "general",
    );
    const same =
      usable.length === this.servers.length &&
      usable.every((s, i) => serverKey(s) === serverKey(this.servers[i]));
    this.servers = usable;
    if (!same) this.changed();
  }
  // Titles found so far, as catalog entries.
  items(): Content[] {
    if (this.snapshot.version === this.version) return this.snapshot.items;
    const items: Content[] = [];
    for (const { seed, found } of this.entries.values()) {
      const hosts = this.ranked(found);
      if (hosts.length) items.push(libraryContent(seed, hosts));
    }
    this.snapshot = { version: this.version, items };
    return items;
  }
  // The servers that have a title, in the order they are listed.
  hostsFor(kind: Kind, tmdbId: number): MediaServer[] {
    return this.ranked(this.entries.get(entryKey(kind, tmdbId))?.found || []);
  }
  private failureCount(key: string): number {
    const f = this.failures.get(key);
    return f && Date.now() - f.at < FAIL_TTL ? f.n : 0;
  }
  // Servers that have the title, the most dependable first (list order breaks ties).
  private ranked(found: string[]): MediaServer[] {
    return this.servers
      .filter((s) => found.includes(serverKey(s)))
      .map((s, i) => ({ s, i, fails: this.failureCount(serverKey(s)) }))
      .sort((a, b) => a.fails - b.fails || a.i - b.i)
      .map(({ s }) => s);
  }
  // Background check: asks every server, so each one that has the title is offered.
  prefetch(seeds: Seed[]) {
    for (const seed of seeds) this.enqueue(seed, false);
  }
  // Opened by the viewer: asks every server so each can serve as a fallback.
  ensure(seed: Seed) {
    this.enqueue(seed, true);
  }
  // A server that failed when the title was opened: drop it for this title.
  reject(url: string) {
    const server = this.servers.find((s) =>
      url.startsWith(`${serverAddress(s.base)}/embed/`),
    );
    const match = /\/embed\/(movie|tv)\/(\d+)/.exec(url);
    if (!server || !match) return;
    const entry = this.entries.get(
      entryKey(match[1] === "movie" ? "movie" : "series", Number(match[2])),
    );
    const key = serverKey(server);
    this.failures.set(key, { n: this.failureCount(key) + 1, at: Date.now() });
    try {
      this.storage?.setItem(
        FAILS,
        JSON.stringify(Object.fromEntries(this.failures)),
      );
    } catch {
      /* Optional. */
    }
    if (!entry?.found.includes(key)) return this.changed();
    entry.found = entry.found.filter((k) => k !== key);
    entry.missing.push(key);
    this.changed();
  }
  private enqueue(seed: Seed, urgent: boolean) {
    if (!this.servers.length) return;
    const key = entryKey(seed.kind, seed.tmdbId);
    const entry = this.entries.get(key);
    const todo = this.servers.filter(
      (s) =>
        !entry?.found.includes(serverKey(s)) &&
        !entry?.missing.includes(serverKey(s)),
    );
    const mark = key;
    if (todo.length === 0 || this.pending.has(mark)) return;
    this.pending.add(mark);
    const task = async () => {
      try {
        for (const server of todo) {
          const state = await probeServer(server, seed.kind, seed.tmdbId);
          if (state === "unknown") continue;
          this.record(seed, server, state === "available");
        }
      } finally {
        this.pending.delete(mark);
      }
    };
    if (urgent) this.queue.unshift(task);
    else this.queue.push(task);
    this.pump();
  }
  private pump() {
    while (this.running < CONCURRENCY && this.queue.length) {
      const task = this.queue.shift()!;
      this.running++;
      void task().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
  private record(seed: Seed, server: MediaServer, found: boolean) {
    const key = entryKey(seed.kind, seed.tmdbId);
    const entry = this.entries.get(key) || {
      seed,
      at: Date.now(),
      found: [],
      missing: [],
    };
    (found ? entry.found : entry.missing).push(serverKey(server));
    this.entries.set(key, entry);
    this.changed();
    try {
      this.storage?.setItem(SLOT, JSON.stringify([...this.entries.values()]));
    } catch {
      /* The cache is optional. */
    }
  }
  // Listeners hear about a burst of results once.
  private changed() {
    this.version++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      for (const listener of this.listeners) listener();
    }, 300);
  }
}
