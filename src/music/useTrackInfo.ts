import { useEffect, useState } from "react";
import type { Content } from "../domain/content";
import {
  lookupsEnabled,
  readSavedLyrics,
  saveLyrics,
} from "../persistence/music";
import { parseLrc } from "./lrc";
import { lookUpTrack, type TrackInfo } from "./lookups";

const cache = new Map<string, TrackInfo>();
const LYRICS_EVENT = "opentv:lyrics";
// Lyrics from a file a person chose (plain text or timed .lrc) for a song that has none.
export function addLyricsText(songId: string, text: string): boolean {
  const synced = parseLrc(text);
  const plain = text.replace(/\[[^\]]*\]/g, "").trim();
  if (!synced.length && !plain) return false;
  const stored = { ...(cache.get(songId) ?? {}) } as TrackInfo;
  cache.set(songId, {
    ...stored,
    synced: synced.length ? synced : undefined,
    plain: plain.slice(0, 20000),
  });
  try {
    saveLyrics(localStorage, songId, text);
  } catch {
    /* Kept for this visit only. */
  }
  window.dispatchEvent(new CustomEvent(LYRICS_EVENT, { detail: songId }));
  return true;
}
// Lyrics and album details for a song, looked up once it starts playing. Null while it is
// being asked, and for anything that is not a song or when the lookups are turned off.
export function useTrackInfo(item: Content): TrackInfo | null {
  const song = item.providerId === "music" ? item : null;
  const [info, setInfo] = useState<TrackInfo | null>(
    song ? (cache.get(song.id) ?? null) : null,
  );
  useEffect(() => {
    if (!song) {
      setInfo(null);
      return;
    }
    try {
      const saved = readSavedLyrics(localStorage, song.id);
      if (saved && !cache.get(song.id)?.synced && !cache.get(song.id)?.plain) {
        const synced = parseLrc(saved);
        cache.set(song.id, {
          ...(cache.get(song.id) ?? {}),
          synced: synced.length ? synced : undefined,
          plain: saved
            .replace(/\[[^\]]*\]/g, "")
            .trim()
            .slice(0, 20000),
        });
      }
    } catch {
      /* Nothing saved. */
    }
    const hit = cache.get(song.id);
    if (hit) {
      setInfo(hit);
      return;
    }
    setInfo(null);
    let enabled = true;
    try {
      enabled = lookupsEnabled(localStorage);
    } catch {
      /* Treat as on. */
    }
    if (!enabled) return;
    const controller = new AbortController();
    void lookUpTrack(
      {
        id: song.providerItemId || "",
        title: song.title,
        artist: song.artist || "",
        duration: song.duration,
      },
      controller.signal,
    ).then((found) => {
      if (controller.signal.aborted) return;
      cache.set(song.id, found);
      setInfo(found);
    });
    return () => controller.abort();
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = song?.id;
    if (!id) return;
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id)
        setInfo(cache.get(id) ?? null);
    };
    window.addEventListener(LYRICS_EVENT, changed);
    return () => window.removeEventListener(LYRICS_EVENT, changed);
  }, [song?.id]);
  return info;
}
