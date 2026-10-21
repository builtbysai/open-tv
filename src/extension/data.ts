import type { MediaServer } from "../domain/servers";
import type { MusicProvider } from "../music/types";
import type { ExtensionFile } from "./format";

// What an extension asks the app to add besides its sources. Music instances and servers are
// added once: an entry a person removed is not put back by a later refresh. Only an import
// they ask for applies the TMDB key and the profile, and a file the site itself serves never
// does, because anyone who opens the site can read that file.
const KEY = "opentv:extension-applied:v1";
export type DataMode = "import" | "start";
export interface ExtensionData {
  musicProviders: MusicProvider[];
  servers: MediaServer[];
  // How many music instances and servers in the file were already on the device.
  already?: number;
  tmdbKey?: string;
  profile?: unknown;
}
export interface DataSummary {
  musicProviders: number;
  servers: number;
  tmdbKey: boolean;
  profile: boolean;
  already: number;
}
// The same server listed twice, by address or by name, is one server.
const addressKey = (base: string) => base.replace(/\/+$/, "").toLowerCase();
export const sameServer = (
  a: Pick<MediaServer, "base" | "name">,
  b: Pick<MediaServer, "base" | "name">,
) =>
  addressKey(a.base) === addressKey(b.base) ||
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
function readApplied(storage: Pick<Storage, "getItem">): Set<string> {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}
// What is new in this file for the given mode, and the ids to remember as applied.
export function newData(
  file: Pick<
    ExtensionFile,
    "musicProviders" | "servers" | "tmdbKey" | "profile"
  >,
  mode: DataMode,
  storage: Pick<Storage, "getItem">,
  has: { music(p: MusicProvider): boolean; server(s: MediaServer): boolean },
): ExtensionData {
  const applied = readApplied(storage);
  // A deliberate import adds whatever is missing, even if it was removed earlier.
  const fresh = <T extends { id: string }>(
    list: T[],
    present: (item: T) => boolean,
  ) =>
    list.filter(
      (item) => !present(item) && (mode === "import" || !applied.has(item.id)),
    );
  return {
    musicProviders: fresh(file.musicProviders ?? [], has.music),
    servers: fresh(file.servers ?? [], has.server).filter(
      (server, i, list) => list.findIndex((s) => sameServer(s, server)) === i,
    ),
    already:
      (file.musicProviders ?? []).filter(has.music).length +
      (file.servers ?? []).filter(has.server).length,
    ...(mode === "import" && file.tmdbKey ? { tmdbKey: file.tmdbKey } : {}),
    ...(mode === "import" && file.profile ? { profile: file.profile } : {}),
  };
}
export function rememberApplied(
  storage: Pick<Storage, "getItem" | "setItem">,
  file: Pick<ExtensionFile, "musicProviders" | "servers">,
) {
  try {
    const applied = readApplied(storage);
    for (const item of [
      ...(file.musicProviders ?? []),
      ...(file.servers ?? []),
    ])
      applied.add(item.id);
    storage.setItem(KEY, JSON.stringify([...applied].slice(-2000)));
  } catch {
    /* Optional. */
  }
}
export const summarize = (data: ExtensionData): DataSummary => ({
  musicProviders: data.musicProviders.length,
  servers: data.servers.length,
  tmdbKey: Boolean(data.tmdbKey),
  profile: Boolean(data.profile),
  already: data.already ?? 0,
});
// "Added 3 sources, 2 music instances."
export function describeImport(
  sources: number,
  summary: DataSummary,
  unresolved = 0,
): string {
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const parts = [
    ...(sources ? [n(sources, "source", "sources")] : []),
    ...(summary.musicProviders
      ? [n(summary.musicProviders, "music instance", "music instances")]
      : []),
    ...(summary.servers ? [n(summary.servers, "server", "servers")] : []),
    ...(summary.tmdbKey ? ["your TMDB key"] : []),
    ...(summary.profile ? ["your saved profile"] : []),
  ];
  const already = summary.already
    ? ` ${summary.already} already on this device.`
    : "";
  const skipped = unresolved
    ? ` ${unresolved} ${unresolved === 1 ? "list is" : "lists are"} stored next to the extension and ${unresolved === 1 ? "was" : "were"} left out: load it from an address, or use the single bundled file.`
    : "";
  if (!parts.length) return `Nothing new in this file.${already}${skipped}`;
  return `Added ${parts.join(", ")}.${already}${skipped}${sources ? " Connect the ones you want below." : ""}`;
}
