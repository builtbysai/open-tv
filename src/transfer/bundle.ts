import { stableId, type Source } from "../domain/content";
import { mediaUrl } from "../domain/urls";
import { validateMusicProvider } from "../persistence/music";
import { validTmdbKey } from "../persistence/tmdb-key";
import type { MusicProvider } from "../music/types";
import {
  validateServer,
  canPersistServer,
  type MediaServer,
} from "../domain/servers";
export interface AccountDraft {
  server: string;
  username: string;
  password: string;
  mode: "live" | "movie" | "series";
  // Absent means Xtream.
  service?: "xtream" | "jellyfin";
}
export interface Bundle {
  v: 1;
  exp: number;
  playlists: Source[];
  servers: MediaServer[];
  musicProviders?: MusicProvider[];
  tmdbKey?: string;
  account?: AccountDraft;
  profile?: unknown;
  // Ids of sources connected on the phone (built-in and extension lists), to connect
  // the same ones here.
  connect?: string[];
}
export const BUNDLE_LIFETIME = 15 * 60 * 1000;
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
// Everything arriving from a phone is untrusted until it passes these checks.
export function parseBundle(value: unknown, now = Date.now()): Bundle {
  const raw = value as Record<string, unknown> | null;
  if (!raw || raw.v !== 1 || typeof raw.exp !== "number" || raw.exp < now)
    throw new Error("expired");
  const playlists: Source[] = [];
  for (const entry of Array.isArray(raw.playlists)
    ? raw.playlists.slice(0, 50)
    : []) {
    const item = entry as Record<string, unknown>;
    const url = typeof item?.url === "string" ? mediaUrl(item.url) : null;
    if (!url || item.kind !== "m3u") continue;
    playlists.push({
      id: stableId(url),
      name: text(item.name, 100) || "My playlist",
      url,
      kind: "m3u",
      classification: ["general", "adult", "unknown"].includes(
        item.classification as string,
      )
        ? (item.classification as Source["classification"])
        : "general",
      enabled: true,
      refreshHours: 24,
      description: "Sent from your phone.",
    });
  }
  const servers = (Array.isArray(raw.servers) ? raw.servers.slice(0, 50) : [])
    .map(validateServer)
    .filter((s): s is MediaServer => !!s && canPersistServer(s));
  const musicProviders = (
    Array.isArray(raw.musicProviders) ? raw.musicProviders.slice(0, 50) : []
  )
    .map(validateMusicProvider)
    .filter((p): p is MusicProvider => !!p);
  const bundle: Bundle = {
    v: 1,
    exp: raw.exp,
    playlists,
    servers,
    ...(musicProviders.length ? { musicProviders } : {}),
  };
  const key = validTmdbKey(raw.tmdbKey);
  if (key) bundle.tmdbKey = key;
  const account = raw.account as Record<string, unknown> | undefined;
  if (account) {
    const server =
      typeof account.server === "string" ? mediaUrl(account.server) : null;
    const username = text(account.username, 200),
      password = text(account.password, 200);
    if (server && username && password)
      bundle.account = {
        server,
        username,
        password,
        mode: ["live", "movie", "series"].includes(account.mode as string)
          ? (account.mode as AccountDraft["mode"])
          : "movie",
        ...(account.service === "jellyfin"
          ? { service: "jellyfin" as const }
          : {}),
      };
  }
  if (raw.profile && typeof raw.profile === "object")
    bundle.profile = raw.profile;
  const connect = (
    Array.isArray(raw.connect) ? raw.connect.slice(0, 300) : []
  ).filter(
    (id): id is string =>
      typeof id === "string" && /^[a-z0-9-]{1,63}$/.test(id),
  );
  if (connect.length) bundle.connect = connect;
  return bundle;
}
export const bundleIsEmpty = (b: Bundle) =>
  !b.playlists.length &&
  !b.servers.length &&
  !b.musicProviders?.length &&
  !b.tmdbKey &&
  !b.account &&
  !b.profile &&
  !b.connect?.length;
