import { computed, signal } from "@preact/signals";
import { persisted } from "../core/store";
import { merge, parseDoc, prune, put, remove, type Doc } from "../core/lww";
import { parseRef, refKey, type MediaRef } from "../core/module";
import { validateServer, type Server } from "../modules/movies/servers";

// Everything a person owns, as one last-writer-wins document (core/lww.ts): the TMDB key,
// servers, preferences, My List and where they stopped. The same document lives on the TV
// and on each phone and is kept equal over the relay (remote/sync.ts), end-to-end encrypted.
//
//   cfg:tmdb                    the TMDB key (a string)
//   srv:<id>                    a Server
//   pref:<name>                 a preference
//   list:<mod>:<kind>:<id>      a My List entry (a MediaRef)
//   prog:<mod>:<kind>:<id>      where they stopped (a Progress)
//
// A new module adds its own keys under these prefixes; nothing else has to change.

export interface Progress {
  ref: MediaRef; // for a show, the episode they were on
  t: number; // seconds
  d: number; // duration, 0 when unknown
  done?: boolean;
  // The next episode is queued but not started: shown as "Up next".
  pending?: boolean;
}

// Only what a list needs, so the document stays small.
export const slim = (ref: MediaRef): MediaRef => {
  const { overview: _o, backdrop: _b, ...rest } = ref;
  return rest;
};

const entryValue = (doc: Doc, key: string): unknown => doc[key]?.[1];

class Data {
  doc = persisted<Doc>("otv:doc", {}, (v) => parseDoc(v));
  private listeners = new Set<(keys: string[]) => void>();
  // Bumped when remote changes arrive, for screens that want a cue.
  remoteTick = signal(0);

  tmdbKey = computed(() => {
    const v = entryValue(this.doc.value, "cfg:tmdb");
    return typeof v === "string" ? v : "";
  });
  lang = computed(() => {
    const v = entryValue(this.doc.value, "pref:lang");
    return typeof v === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(v) ? v : navigator.language || "en-US";
  });
  servers = computed<Server[]>(() => {
    const out: Server[] = [];
    for (const key of Object.keys(this.doc.value))
      if (key.startsWith("srv:")) {
        const s = validateServer(entryValue(this.doc.value, key));
        if (s) out.push(s);
      }
    return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  });
  list = computed<MediaRef[]>(() => {
    const rows: { at: number; ref: MediaRef }[] = [];
    for (const key of Object.keys(this.doc.value))
      if (key.startsWith("list:")) {
        const ref = parseRef(entryValue(this.doc.value, key));
        if (ref) rows.push({ at: this.doc.value[key][0], ref });
      }
    return rows.sort((a, b) => b.at - a.at).map((r) => r.ref);
  });
  progress = computed<Record<string, Progress & { at: number }>>(() => {
    const out: Record<string, Progress & { at: number }> = {};
    for (const key of Object.keys(this.doc.value))
      if (key.startsWith("prog:")) {
        const v = entryValue(this.doc.value, key) as Record<string, unknown> | null;
        const ref = v && parseRef(v.ref);
        if (v && ref && typeof v.t === "number" && typeof v.d === "number")
          out[key.slice(5)] = {
            ref,
            t: v.t,
            d: v.d,
            done: v.done === true,
            pending: v.pending === true,
            at: this.doc.value[key][0],
          };
      }
    return out;
  });
  continueWatching = computed(() =>
    Object.values(this.progress.value)
      .filter((p) => !p.done && (p.t >= 5 || p.pending))
      .sort((a, b) => b.at - a.at)
      .slice(0, 20),
  );

  // Every local change goes through here: stamp, prune, announce.
  private commit(next: (doc: Doc, now: number) => Doc, keys: string[]) {
    const now = Date.now();
    this.doc.value = prune(next(this.doc.value, now), now);
    for (const cb of this.listeners) cb(keys);
  }
  onLocalChange(cb: (keys: string[]) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  // A remote document arrived. Returns the keys that actually changed.
  applyRemote(remote: Doc): string[] {
    const { doc, changed } = merge(this.doc.value, remote);
    if (changed.length) {
      this.doc.value = prune(doc, Date.now());
      this.remoteTick.value++;
    }
    return changed;
  }

  // Merges a backup file and tells peers (the TV) about what changed. Newer entries win, so
  // importing an old backup never undoes later changes.
  importDoc(remote: Doc): number {
    const changed = this.applyRemote(remote);
    if (changed.length) for (const cb of this.listeners) cb(changed);
    return changed.length;
  }
  exportDoc(): string {
    return JSON.stringify({ app: "open-tv", version: 1, doc: this.doc.value }, null, 2);
  }

  setTmdbKey(key: string) {
    this.commit((d, n) => put(d, "cfg:tmdb", key.trim(), n), ["cfg:tmdb"]);
  }
  setPref(name: string, value: unknown) {
    this.commit((d, n) => put(d, `pref:${name}`, value, n), [`pref:${name}`]);
  }
  saveServer(server: Server) {
    this.commit((d, n) => put(d, `srv:${server.id}`, server, n), [`srv:${server.id}`]);
  }
  removeServer(id: string) {
    this.commit((d, n) => remove(d, `srv:${id}`, n), [`srv:${id}`]);
  }
  // Moves a server up or down the order (servers are tried in order).
  moveServer(id: string, by: -1 | 1) {
    const list = this.servers.value;
    const i = list.findIndex((s) => s.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const keys = reordered.map((s) => `srv:${s.id}`);
    this.commit(
      (d, n) => reordered.reduce((doc, s, index) => put(doc, `srv:${s.id}`, { ...s, order: index }, n), d),
      keys,
    );
  }

  inList = (ref: MediaRef) => `list:${refKey(ref)}` in this.doc.value && entryValue(this.doc.value, `list:${refKey(ref)}`) !== null;
  toggleList(ref: MediaRef) {
    const key = `list:${refKey(ref)}`;
    const base = ref.kind === "episode" ? { ...ref, kind: "tv" } : ref;
    if (this.inList(ref)) this.commit((d, n) => remove(d, key, n), [key]);
    else this.commit((d, n) => put(d, key, slim({ ...base, season: undefined, episode: undefined, epTitle: undefined }), n), [key]);
  }

  progressOf(ref: MediaRef): (Progress & { at: number }) | undefined {
    return this.progress.value[refKey(ref)];
  }
  saveProgress(ref: MediaRef, t: number, d: number, extra: { pending?: boolean } = {}) {
    const key = `prog:${refKey(ref)}`;
    // Watched to the end: nearly all of it, or (for long titles) only the credits are left.
    const finished = d > 0 && (t / d > 0.94 || (d > 300 && d - t < 90));
    const value: Progress = { ref: slim(ref), t: Math.floor(t), d: Math.floor(d), ...(finished ? { done: true } : {}), ...extra };
    this.commit((doc, n) => put(doc, key, value, n), [key]);
  }
  clearProgress(ref: MediaRef) {
    const key = `prog:${refKey(ref)}`;
    this.commit((d, n) => remove(d, key, n), [key]);
  }
}

export const data = new Data();
