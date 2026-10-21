import type { Source } from "../domain/content";
import { AppError } from "../domain/errors";
import { stableId } from "../domain/content";
import { validateServer, type MediaServer } from "../domain/servers";
import { validateMusicProvider } from "../persistence/music";
import type { MusicProvider } from "../music/types";
import { validTmdbKey } from "../persistence/tmdb-key";

// An extension is one JSON file that adds sources to the app: remote lists by address, or
// playlists and catalogs carried inside the file. The app ships none; people add their own.
//
//   {
//     "format": "open-tv-extension",
//     "version": 1,
//     "name": "My extension",
//     "sources": [
//       { "id": "my-news", "name": "My news", "kind": "m3u", "url": "https://…/news.m3u" },
//       { "id": "my-films", "name": "My films", "kind": "m3u", "m3u": "#EXTM3U\n#EXTINF:…" },
//       { "id": "my-guide", "name": "My catalog", "kind": "catalog", "items": [ … ] },
//       { "id": "my-18", "name": "…", "kind": "m3u", "classification": "adult", "url": "…" }
//     ]
//   }
//
// Each source has exactly one of `url`, `m3u` (playlist text) or `items` (catalog entries).
//
// An extension can also carry settings, all optional:
//   "musicProviders": [ { "name": "My instance", "type": "invidious" | "piped", "base": "https://…" } ]
//   "servers":        [ { "name": "My server", "base": "https://…", "guard": "click", "enabled": true } ]
//                     (no credentials: a server is an address, and is added once per device)
//   "guides":         [ { "name": "My guide", "url": "https://…/guide.xml" } ]  (offered in TV guide settings)
//   "tmdbKey":        "…"          (only applied when a person imports the file; a placeholder
//                                   such as "YOUR_TMDB_API_KEY" is ignored)
//   "profile":        { … }        (a general-profile backup, only applied when imported)
// A file may have settings and no sources at all.
export const EXTENSION_FORMAT = "open-tv-extension";
export const MAX_EXTENSION_BYTES = 60_000_000;
const MAX_SOURCES = 500;
const MAX_PLAYLIST = 15_000_000;
const MAX_ITEMS = 100_000;

export interface ExtensionSource {
  id: string;
  name: string;
  kind: "m3u" | "catalog";
  classification: "general" | "adult";
  enabled: boolean;
  description: string;
  provenance?: string;
  refreshHours: number;
  priority: number;
  url?: string;
  m3u?: string;
  items?: unknown[];
}
export interface ExtensionFile {
  format: typeof EXTENSION_FORMAT;
  version: 1;
  name: string;
  sources: ExtensionSource[];
  musicProviders: MusicProvider[];
  servers: MediaServer[];
  // XMLTV guides the extension suggests. They are offered, never connected on their own.
  guides: { name: string; url: string }[];
  tmdbKey?: string;
  profile?: unknown;
  // Sources left out because their address is relative (a file next to the extension) and
  // the extension was not loaded from an address, so there is nothing to resolve it against.
  unresolved?: number;
}
const MAX_PROFILE = 2_000_000;

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function httpsUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

// A source's data can sit in a file next to the extension ("extension-data/europe.json"). Such
// a relative path stays inside the folder the extension came from, so it is resolved against
// the address the extension was loaded from (`base`).
const RELATIVE =
  /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
function resolveRelative(value: unknown, base?: string): string | undefined {
  if (typeof value !== "string" || !RELATIVE.test(value) || !base)
    return undefined;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) &&
      url.origin === new URL(base).origin
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
const isRelative = (value: unknown) =>
  typeof value === "string" && RELATIVE.test(value);

// Reads and checks an extension. Anything that is not understood is left out, and a file
// with nothing usable in it is refused with a plain reason.
export function parseExtension(input: unknown, base?: string): ExtensionFile {
  const raw = typeof input === "string" ? safeJson(input) : input;
  const file = raw as Record<string, unknown> | null;
  if (!file || typeof file !== "object" || file.format !== EXTENSION_FORMAT)
    throw new AppError(
      "format",
      'This is not an Open TV extension file. It should start with { "format": "open-tv-extension" }.',
    );
  if (file.version !== 1)
    throw new AppError(
      "format",
      "This extension was made for a different version of Open TV.",
    );
  if (file.sources !== undefined && !Array.isArray(file.sources))
    throw new AppError("format", "The extension has no list of sources.");
  const seen = new Set<string>();
  const sources: ExtensionSource[] = [];
  let unresolved = 0;
  for (const entry of (Array.isArray(file.sources) ? file.sources : []).slice(
    0,
    MAX_SOURCES,
  )) {
    const s = entry as Record<string, unknown> | null;
    if (!s || typeof s !== "object") continue;
    const id = text(s.id, 63);
    const name = text(s.name, 100);
    const kind = s.kind === "m3u" || s.kind === "catalog" ? s.kind : null;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || !name || !kind) continue;
    if (seen.has(id)) continue;
    let url = s.url === undefined ? undefined : httpsUrl(s.url);
    if (url === undefined && isRelative(s.url)) {
      url = resolveRelative(s.url, base);
      if (url === undefined) {
        unresolved++;
        continue;
      }
    }
    const m3u = typeof s.m3u === "string" ? s.m3u : undefined;
    const items = Array.isArray(s.items) ? s.items : undefined;
    // Exactly one place for the data.
    if (
      [url, m3u, items].filter((v) => v !== undefined).length !== 1 ||
      (m3u !== undefined && (!m3u.trim() || m3u.length > MAX_PLAYLIST)) ||
      (items !== undefined && items.length > MAX_ITEMS) ||
      (kind === "m3u" && items !== undefined) ||
      (kind === "catalog" && m3u !== undefined)
    )
      continue;
    seen.add(id);
    const provenance = httpsUrl(s.provenance);
    sources.push({
      id,
      name,
      kind,
      classification: s.classification === "adult" ? "adult" : "general",
      enabled: s.enabled === true,
      description: text(s.description, 1000) || "From your extension.",
      ...(provenance ? { provenance } : {}),
      priority: Math.min(
        100,
        Math.max(-100, Math.floor(Number(s.priority)) || 0),
      ),
      refreshHours: Math.min(
        720,
        Math.max(1, Math.floor(Number(s.refreshHours)) || 24),
      ),
      ...(url ? { url } : {}),
      ...(m3u !== undefined ? { m3u } : {}),
      ...(items ? { items } : {}),
    });
  }
  const musicProviders = listOf(file.musicProviders).flatMap((entry) => {
    const e = entry as Record<string, unknown> | null;
    const base = typeof e?.base === "string" ? e.base : "";
    const found = validateMusicProvider({ ...e, id: musicProviderId(e, base) });
    return found ? [found] : [];
  });
  const servers = listOf(file.servers).flatMap((entry) => {
    const e = entry as Record<string, unknown> | null;
    const found = validateServer({
      ...e,
      id: stableId(`server:${String(e?.base ?? "")}`),
      classification: "general",
    });
    return found ? [found] : [];
  });
  const guides = listOf(file.guides).flatMap((entry) => {
    const e = entry as Record<string, unknown> | null;
    const url = httpsUrl(e?.url);
    const name = text(e?.name, 100);
    return url && name && !new URL(url).hash ? [{ name, url }] : [];
  });
  // A placeholder left in a template is treated as no key at all.
  const tmdbKey = validTmdbKey(file.tmdbKey);
  const profile =
    file.profile &&
    typeof file.profile === "object" &&
    JSON.stringify(file.profile).length <= MAX_PROFILE
      ? file.profile
      : undefined;
  if (unresolved && !sources.length)
    throw new AppError(
      "format",
      "This extension keeps its lists in files next to it. Load it from an address, or use the single bundled file.",
    );
  if (
    !sources.length &&
    !musicProviders.length &&
    !servers.length &&
    !guides.length &&
    !profile
  )
    throw new AppError(
      "format",
      "The extension has nothing usable in it. A source needs an id, a name, a kind of m3u or catalog, and one of url, m3u or items; a music instance needs a name, a type and an address.",
    );
  return {
    format: EXTENSION_FORMAT,
    version: 1,
    name: text(file.name, 100) || "Extension",
    sources,
    musicProviders: uniqueBy(musicProviders, (p) => p.id),
    servers: uniqueBy(servers, (s) => s.id),
    guides: uniqueBy(guides, (g) => g.url),
    ...(tmdbKey ? { tmdbKey } : {}),
    ...(profile ? { profile } : {}),
    ...(unresolved ? { unresolved } : {}),
  };
}
const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value.slice(0, 50) : [];
const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    return !seen.has(k) && !!seen.add(k);
  });
};
// The same instance always gets the same id, so loading a file twice adds it once.
function musicProviderId(
  e: Record<string, unknown> | null,
  base: string,
): string {
  return stableId(
    `music-provider:${String(e?.type)}:${base.replace(/\/+$/, "").toLowerCase()}`,
  );
}
function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError("format", "This file is not valid JSON.");
  }
}

// The app's view of an extension source. Playlist text and catalog entries stay in the
// extension store; the source only says that they are there.
export function toSource(s: ExtensionSource): Source {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    classification: s.classification,
    enabled: s.enabled,
    description: s.description,
    provenance: s.provenance,
    refreshHours: s.refreshHours,
    extension: true,
    priority: s.priority,
    ...(s.url ? { url: s.url } : { inline: true }),
  };
}
