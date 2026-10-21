import type { Kind, Seed } from "./embed-library";
// What a wished-for title needs to be shown again: enough to draw a card, not a catalog.
export interface Wish {
  kind: Kind;
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string;
}
export const MAX_WISHES = 300;
export const wishKey = (w: Pick<Wish, "kind" | "tmdbId">) =>
  `${w.kind}:${w.tmdbId}`;
const posterOk = (value: unknown): value is string =>
  typeof value === "string" &&
  /^https:\/\/image\.tmdb\.org\/t\/p\/[a-z0-9]+\/[a-z0-9._-]+$/i.test(value);
export function cleanWish(value: unknown): Wish | null {
  const w = value as Partial<Wish> | null;
  if (
    !w ||
    typeof w !== "object" ||
    (w.kind !== "movie" && w.kind !== "series") ||
    !Number.isSafeInteger(w.tmdbId) ||
    (w.tmdbId as number) <= 0 ||
    typeof w.title !== "string" ||
    !w.title.trim()
  )
    return null;
  return {
    kind: w.kind,
    tmdbId: w.tmdbId as number,
    title: w.title.trim().slice(0, 200),
    year:
      Number.isInteger(w.year) && (w.year as number) > 1800
        ? w.year
        : undefined,
    poster: posterOk(w.poster) ? w.poster : undefined,
  };
}
export const wishFromSeed = (seed: Seed): Wish => ({
  kind: seed.kind,
  tmdbId: seed.tmdbId,
  title: seed.title,
  year: seed.year,
  poster: seed.poster,
});
export const isWished = (list: Wish[], seed: Pick<Seed, "kind" | "tmdbId">) =>
  list.some((w) => wishKey(w) === wishKey(seed));
export function toggleWish(list: Wish[], seed: Seed): Wish[] {
  if (isWished(list, seed))
    return list.filter((w) => wishKey(w) !== wishKey(seed));
  return [wishFromSeed(seed), ...list].slice(0, MAX_WISHES);
}
export function mergeWishes(a: Wish[], b: Wish[]): Wish[] {
  const map = new Map<string, Wish>();
  for (const w of [...a, ...b])
    if (!map.has(wishKey(w))) map.set(wishKey(w), w);
  return [...map.values()].slice(0, MAX_WISHES);
}
