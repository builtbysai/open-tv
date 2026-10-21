import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stableId, type Content } from "../domain/content";
import { musicApi } from "../music/api";
import { failureReason } from "../music/http";
import { musicClient } from "../music/client";
import { songContent } from "../music/content";
import type { MusicProvider, Song } from "../music/types";
import {
  lookupsEnabled,
  MUSIC_CHECKS_KEY,
  readMusicProviders,
  readRecentSongs,
  recentSongsKey,
  rememberSong,
  setLookupsEnabled,
  writeMusicProviders,
} from "../persistence/music";
import {
  readChecks,
  writeChecks,
  type ServerCheck,
} from "../persistence/servers";

const storage = () => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};
// Music providers (their order is the order they are tried in), their last health check,
// the songs played lately, and whether lyrics and album art are looked up.
export function useMusic(profileId = "main") {
  const recentKey = recentSongsKey(profileId);
  const [providers, setProviders] = useState(() => {
    const store = storage();
    return store ? readMusicProviders(store) : [];
  });
  musicClient.setProviders(providers);
  const [checks, setChecks] = useState<Record<string, ServerCheck>>(() => {
    const store = storage();
    return store ? readChecks(store, MUSIC_CHECKS_KEY) : {};
  });
  const [checking, setChecking] = useState<string[]>([]);
  const [recent, setRecent] = useState<Song[]>(() =>
    readRecentSongs(storage(), recentKey),
  );
  const [lookups, setLookups] = useState(() => lookupsEnabled(storage()));
  const latest = useRef(providers);
  latest.current = providers;
  useEffect(() => {
    const store = storage();
    if (store) writeMusicProviders(store, providers);
  }, [providers]);

  // One real request, the same a person would make: it is healthy when it answers.
  const check = useCallback(async (provider: MusicProvider) => {
    setChecking((old) => [...old, provider.id]);
    let ok = true;
    let reason: string | undefined;
    try {
      await musicApi(provider).trending(AbortSignal.timeout(10000));
    } catch (error) {
      ok = false;
      reason = failureReason(error);
    }
    setChecking((old) => old.filter((id) => id !== provider.id));
    setChecks((old) => {
      const next = {
        ...old,
        [provider.id]: { ok, at: Date.now(), ...(reason ? { reason } : {}) },
      };
      const store = storage();
      if (store) writeChecks(store, next, MUSIC_CHECKS_KEY);
      return next;
    });
  }, []);
  const save = useCallback(
    (provider: MusicProvider) => {
      setProviders((old) =>
        old.some((p) => p.id === provider.id)
          ? old.map((p) => (p.id === provider.id ? provider : p))
          : [...old, provider],
      );
      if (provider.enabled) void check(provider);
    },
    [check],
  );
  const remove = useCallback(
    (id: string) => setProviders((old) => old.filter((p) => p.id !== id)),
    [],
  );
  // Moves one provider a step earlier (-1) or later (1) in the order they are tried.
  const move = useCallback((id: string, step: -1 | 1) => {
    setProviders((old) => {
      const i = old.findIndex((p) => p.id === id);
      const j = i + step;
      if (i < 0 || j < 0 || j >= old.length) return old;
      const next = [...old];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);
  const remember = useCallback(
    (song: Song) => setRecent(rememberSong(storage(), song, recentKey)),
    [recentKey],
  );
  // Clearing viewing history clears the songs played lately too.
  const clearRecent = useCallback(() => {
    try {
      storage()?.removeItem(recentKey);
    } catch {
      /* Nothing stored. */
    }
    setRecent([]);
  }, [recentKey]);
  const setLookups_ = useCallback((on: boolean) => {
    setLookupsEnabled(storage(), on);
    setLookups(on);
  }, []);
  // Songs played before show up in Listen again and History like any other audio.
  const items: Content[] = useMemo(() => recent.map(songContent), [recent]);
  const newId = () => stableId(`music-provider:${crypto.randomUUID()}`);
  return {
    providers,
    checks,
    checking,
    check,
    save,
    remove,
    move,
    newId,
    recent,
    remember,
    clearRecent,
    items,
    lookups,
    setLookups: setLookups_,
  };
}
export type MusicState = ReturnType<typeof useMusic>;
