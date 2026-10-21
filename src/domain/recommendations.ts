import type { Content } from "./content";
import type { ContentPolicy } from "./content-policy";
import { queryCatalog } from "./privacy";

interface Signals {
  favorites: readonly string[];
  history: readonly { id: string }[];
  policy?: ContentPolicy;
  limit?: number;
}
// Local, deterministic suggestions. Private items and activity never become
// signals, and the same query/restriction rules apply before ranking.
export function recommend(items: Content[], signals: Signals): Content[] {
  const allowed = queryCatalog(items, { policy: signals.policy });
  const byId = new Map<string, Content>();
  for (const item of allowed)
    for (const id of [item.id, ...(item.aliases || [])]) byId.set(id, item);
  const weights = new Map<Content, number>();
  for (const id of signals.favorites.slice(0, 100)) {
    const item = byId.get(id);
    if (item) weights.set(item, 4);
  }
  signals.history.slice(0, 30).forEach(({ id }, index) => {
    const item = byId.get(id);
    if (item && !weights.has(item)) weights.set(item, 2 / (1 + index / 5));
  });
  if (!weights.size) return [];
  const tastes = {
    genres: new Map<string, number>(),
    languages: new Map<string, number>(),
    countries: new Map<string, number>(),
  };
  const dimensions = ["genres", "languages", "countries"] as const;
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().toLocaleLowerCase();
  for (const [item, weight] of weights)
    for (const dimension of dimensions)
      for (const value of new Set(item[dimension].map(normalize)))
        if (value)
          tastes[dimension].set(
            value,
            (tastes[dimension].get(value) || 0) + weight,
          );
  const seen = new Set([
    ...signals.favorites,
    ...signals.history.map((h) => h.id),
  ]);
  const candidates = allowed
    .flatMap((item) => {
      if (
        [item.id, ...(item.aliases || [])].some((id) => seen.has(id)) ||
        item.type === "episode" ||
        item.availability !== "playable" ||
        (!item.streams.length && item.type !== "series")
      )
        return [];
      const strength = dimensions.map((dimension) =>
        Math.max(
          0,
          ...item[dimension].map(
            (value) => tastes[dimension].get(normalize(value)) || 0,
          ),
        ),
      );
      // Shared language alone is not sufficient to claim a meaningful suggestion.
      if (!strength[0] && !strength[2]) return [];
      const score =
        Math.min(strength[0], 12) * 3 +
        Math.min(strength[1], 8) +
        Math.min(strength[2], 8) * 0.5;
      return [{ item, score }];
    })
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const result: Content[] = [],
    emitted = new Set<string>();
  const max = Math.max(0, Math.min(24, Math.floor(signals.limit ?? 12)));
  for (const { item } of candidates) {
    if (result.length >= max) break;
    const aliases = [item.id, ...(item.aliases || [])];
    if (aliases.some((id) => emitted.has(id))) continue;
    result.push(item);
    for (const id of aliases) emitted.add(id);
  }
  return result;
}
