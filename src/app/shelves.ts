import type { Content } from "../domain/content";
import { isArchive } from "../domain/discover";
import { contentAliases, type UserState } from "../persistence/user-state";

export interface Shelf {
  title: string;
  items: Content[];
  // Lead shelves sit near the top of Home, before "For you".
  lead?: boolean;
}
export type LocalSignal = Pick<UserState, "history" | "progress">;
// Fewer titles than this and "Popular on your servers" is left out.
export const MIN_ON_SERVERS = 3;
const RECENT = 45 * 24 * 3600 * 1000;

// One key per title, so a TMDB listing and the matching server title count as the same.
const keysOf = (item: Content) => [
  item.id,
  ...(item.tmdbId
    ? [`${item.type === "series" ? "series" : "movie"}:${item.tmdbId}`]
    : []),
];
// Each title appears in at most one shelf; earlier shelves keep it. Empty shelves go.
export function dedupeShelves(shelves: Shelf[]): Shelf[] {
  const seen = new Set<string>();
  return shelves
    .map((shelf) => ({
      ...shelf,
      items: shelf.items.filter((item) => {
        const keys = keysOf(item);
        if (keys.some((k) => seen.has(k))) return false;
        keys.forEach((k) => seen.add(k));
        return true;
      }),
    }))
    .filter((shelf) => shelf.items.length > 0);
}
// Titles you own, ranked by what happens on this device: how often each was played,
// how far you got, and how recently it arrived. Titles with no signal are left out.
export function rankOnServers(
  owned: Content[],
  signal: LocalSignal,
  now = Date.now(),
): Content[] {
  return owned
    .filter((item) => !isArchive(item))
    .map((item) => {
      const aliases = new Set(contentAliases(item));
      const plays = signal.history.filter((h) => aliases.has(h.id));
      const progress = Math.max(
        0,
        ...[...aliases].map((id) => signal.progress[id] || 0),
      );
      const age = item.addedAt ? now - item.addedAt : Infinity;
      const score =
        plays.length * 2 +
        (progress > 10 ? 1 + Math.min(progress / 3600, 1) : 0) +
        (age >= 0 && age < RECENT ? 1 - age / RECENT : 0);
      const last = Math.max(0, ...plays.map((h) => h.at));
      return { item, score, last };
    })
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.last - a.last ||
        (b.item.addedAt || 0) - (a.item.addedAt || 0),
    )
    .map((r) => r.item);
}
// Owned films and series that can be played or opened to their episodes.
export const isOwnedTitle = (item: Content) =>
  ["movie", "series", "documentary", "anime"].includes(item.type) &&
  (item.availability === "playable" ||
    (item.type === "series" && item.tmdbId !== undefined));
