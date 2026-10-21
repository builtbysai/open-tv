import { useEffect, useReducer, useRef } from "react";
import type { Source } from "../domain/content";
import type { MediaServer } from "../domain/servers";
import type { MusicProvider } from "../music/types";
import { SYNC_BYTES, type Peer } from "../remote/protocol";
import {
  compact,
  emptyDoc,
  merge,
  pick,
  prune,
  stamp,
  type SyncDoc,
  type SyncEntry,
} from "./doc";
import {
  applyToUser,
  cleanValue,
  snapshot,
  sourceFrom,
  type SourceValue,
  type SyncState,
} from "./state";
import {
  readDoc,
  statusLine,
  syncStatus,
  writeDoc,
  writeOutgoing,
} from "./store";

const THROTTLE = 2000;
const DAY = 24 * 3600 * 1000;
export interface SyncApply {
  user(update: (old: SyncState["user"]) => SyncState["user"]): void;
  source(source: Source): void;
  removeSource(id: string): void;
  // A list from an extension this device hasn't loaded: remembered for when it does.
  rememberList(id: string, enabled: boolean): void;
  server(server: MediaServer): void;
  removeServer(id: string): void;
  music(provider: MusicProvider): void;
  removeMusic(id: string): void;
  lookups(on: boolean): void;
}
export type SyncInbox = (doc: SyncDoc, full: boolean, from?: string) => void;

// Keeps this profile's sync document up to date and exchanges it with paired devices:
// the whole document when a peer comes online (the other side answers with what it
// lacks), the changes since (at most every two seconds) while it stays online.
export function useSync({
  profileId,
  tv,
  state,
  builtIn,
  peers,
  paired,
  send,
  hide,
  apply,
  onNotice,
}: {
  profileId: string;
  tv: boolean;
  state: SyncState;
  builtIn: ReadonlyMap<string, boolean>;
  // Paired devices online now, and all paired devices.
  peers: Peer[];
  paired: Peer[];
  send(doc: SyncDoc, full: boolean, to?: string): boolean;
  // Keys left out of what is sent (18+ titles).
  hide(key: string): boolean;
  apply: SyncApply;
  onNotice(message: string): void;
}): SyncInbox {
  const doc = useRef<SyncDoc | null>(null);
  const first = useRef(false);
  if (!doc.current) {
    const saved = readDoc(profileId);
    first.current = !saved;
    doc.current = saved ?? emptyDoc();
  }
  const latest = useRef({ state, builtIn, peers, send, hide, apply });
  latest.current = { state, builtIn, peers, send, hide, apply };
  const dirty = useRef(new Set<string>());
  const timers = useRef({ send: 0, save: 0 });
  // Applied changes reach the app's state on the next render; until then the state here
  // is older than the document and must not be stamped.
  const applying = useRef(false);
  const [tick, rerender] = useReducer((n: number) => n + 1, 0);

  const save = () => {
    clearTimeout(timers.current.save);
    timers.current.save = window.setTimeout(() => {
      writeDoc(profileId, doc.current!);
      writeOutgoing(outgoing(doc.current!));
    }, 800);
  };
  // Kept a little under the limit the relay checks, which counts the wrapper too.
  const outgoing = (d: SyncDoc) =>
    compact(d, SYNC_BYTES - 1024, latest.current.hide);
  const flush = () => {
    timers.current.send = 0;
    const { peers, send } = latest.current;
    if (!dirty.current.size || !peers.length) return;
    if (send(outgoing(pick(doc.current!, dirty.current)), false))
      dirty.current.clear();
  };
  const local = () => {
    if (applying.current) return;
    const { state, builtIn } = latest.current;
    const result = stamp(
      doc.current!,
      snapshot(state, builtIn),
      Date.now(),
      first.current,
    );
    first.current = false;
    doc.current = result.doc;
    if (!result.changed.length) return;
    for (const key of result.changed) dirty.current.add(key);
    save();
    if (!timers.current.send)
      timers.current.send = window.setTimeout(flush, THROTTLE);
  };
  const { user, sources, servers, music, lookups } = state;
  useEffect(() => {
    applying.current = false;
    local();
    // Runs when the synced parts of the state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user.favorites,
    user.wishlist,
    user.collections,
    user.history,
    user.progress,
    sources,
    servers,
    music,
    lookups,
    tick,
  ]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      clearTimeout(pending.send);
      if (pending.save) {
        clearTimeout(pending.save);
        writeDoc(profileId, doc.current!);
      }
    };
  }, [profileId]);

  // A peer that comes online gets the whole document.
  const online = useRef(new Set<string>());
  const peerIds = peers.map((p) => p.id).join(",");
  useEffect(() => {
    const now = new Set(peers.map((p) => p.id));
    for (const id of now)
      if (!online.current.has(id)) {
        local();
        send(outgoing(doc.current!), true, id);
      }
    online.current = now;
    // The peers' ids decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerIds]);

  // A removed pairing ends syncing, and this side says so.
  const known = useRef<Peer[] | null>(null);
  const pairedIds = paired.map((p) => p.id).join(",");
  useEffect(() => {
    const before = known.current;
    known.current = paired;
    if (!before) return;
    for (const peer of before) {
      if (paired.some((p) => p.id === peer.id)) continue;
      // Pairing again from the same device replaces its entry.
      if (
        paired.some(
          (p) => p.name === peer.name && !before.some((b) => b.id === p.id),
        )
      )
        continue;
      syncStatus.stopped(peer.name);
      onNotice(statusLine(syncStatus.get(), tv));
    }
    // The paired devices' ids decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairedIds]);

  return (incoming, full, from) => {
    local();
    const now = Date.now();
    const clean: SyncDoc = { v: 1, e: {} };
    for (const [key, [t, value]] of Object.entries(incoming.e)) {
      const v = cleanValue(key, value);
      // A clock far ahead can't win forever.
      if (v !== undefined) clean.e[key] = [Math.min(t, now + DAY), v];
    }
    const result = merge(doc.current!, clean);
    doc.current = prune(result.doc, now);
    save();
    if (result.changed.length) {
      applyChanges(result.changed.map((key) => [key, doc.current!.e[key]]));
      applying.current = true;
      rerender();
    }
    const peer = latest.current.peers.find((p) => p.id === from) ??
      latest.current.peers[0] ?? { name: tv ? "your phone" : "your TV" };
    syncStatus.synced(peer.name);
    if (full && result.behind.length)
      latest.current.send(
        outgoing(pick(doc.current, result.behind)),
        false,
        from,
      );
  };

  function applyChanges(changes: [string, SyncEntry | undefined][]) {
    const { state, apply, builtIn } = latest.current;
    const library: Record<string, unknown> = {};
    // Older first, so playlists keep the order they were added in.
    changes.sort((a, b) => (a[1]?.[0] ?? 0) - (b[1]?.[0] ?? 0));
    for (const [key, entry] of changes) {
      if (!entry) continue;
      const value = entry[1];
      const kind = key.slice(0, key.indexOf(":"));
      const id = key.slice(key.indexOf(":") + 1);
      if (["fav", "wish", "coll", "hist", "prog"].includes(kind)) {
        library[key] = value;
        continue;
      }
      if (kind === "src") {
        const existing = state.sources.find((s) => s.id === id);
        if (value === null) {
          if (existing) apply.removeSource(id);
          continue;
        }
        const v = value as SourceValue;
        const definition = sourceFrom(id, v);
        if (!existing) {
          if (definition) apply.source(definition);
          else apply.rememberList(id, v.on);
        } else if (existing.classification === "general") {
          const next =
            definition && !existing.extension && !builtIn.has(id)
              ? { ...existing, ...definition }
              : { ...existing, enabled: v.on };
          if (JSON.stringify(next) !== JSON.stringify(existing))
            apply.source(next);
        }
      } else if (kind === "srv") {
        const existing = state.servers.find((s) => s.id === id);
        if (value === null) {
          if (existing) apply.removeServer(id);
        } else if (JSON.stringify(existing) !== JSON.stringify(value))
          apply.server(value as MediaServer);
      } else if (kind === "mus") {
        if (value === null) {
          if (state.music.some((p) => p.id === id)) apply.removeMusic(id);
        } else if (
          JSON.stringify(state.music.find((p) => p.id === id)) !==
          JSON.stringify(value)
        )
          apply.music(value as MusicProvider);
      } else if (key === "set:lookups") apply.lookups(value === true);
    }
    if (Object.keys(library).length)
      apply.user((old) => applyToUser(old, library));
  }
}
