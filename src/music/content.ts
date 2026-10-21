import { stableId, type Content } from "../domain/content";
import { classify } from "../domain/privacy";
import { musicStreamUrl } from "./client";
import type { Song } from "./types";

export const MUSIC_SOURCE_ID = "music";
// A song as a catalog entry, so the audio player, queue, mini-player and visualizer take
// it like any other audio. Its address is a placeholder resolved when it plays.
export function songContent(song: Song): Content {
  return {
    id: stableId(`music:${song.id}`),
    providerId: MUSIC_SOURCE_ID,
    providerItemId: song.id,
    title: song.title,
    artist: song.artist || undefined,
    type: "audio",
    description: song.artist || undefined,
    artwork: song.thumbnail,
    poster: song.thumbnail,
    duration: song.duration,
    genres: ["Music"],
    languages: [],
    countries: [],
    classification: classify(`${song.title} ${song.artist}`, "general"),
    availability: "playable",
    streams: [{ url: musicStreamUrl(song.id), format: "audio" }],
    rights: {
      status: "provider-listed",
      ...(song.source ? { attribution: song.source } : {}),
    },
  };
}
// "PLxxxx", or any address that has list=PLxxxx in it.
export function playlistIdFrom(input: string): string | null {
  const text = input.trim();
  const fromUrl = /[?&]list=([A-Za-z0-9_-]{10,60})/.exec(text)?.[1];
  const id = fromUrl ?? text;
  return /^[A-Za-z0-9_-]{10,60}$/.test(id) ? id : null;
}
