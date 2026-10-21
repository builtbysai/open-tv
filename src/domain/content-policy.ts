import { stableId, type Content } from "./content";
import policy from "../policy/restrictions.json";
export interface ContentPolicy {
  blockedContentIds: readonly string[];
  blockedProviderIds: readonly string[];
  blockedStreamIds: readonly string[];
}
export function hasRestrictions(rules: ContentPolicy): boolean {
  return (
    rules.blockedContentIds.length > 0 ||
    rules.blockedProviderIds.length > 0 ||
    rules.blockedStreamIds.length > 0
  );
}
export function applyContentPolicy(
  items: Content[],
  rules: ContentPolicy = policy,
): Content[] {
  if (
    !rules.blockedContentIds.length &&
    !rules.blockedProviderIds.length &&
    !rules.blockedStreamIds.length
  )
    return items;
  const ids = new Set(rules.blockedContentIds),
    providers = new Set(rules.blockedProviderIds),
    streams = new Set(rules.blockedStreamIds);
  return items.flatMap((item) => {
    if (
      ids.has(item.id) ||
      item.aliases?.some((id) => ids.has(id)) ||
      providers.has(item.providerId)
    )
      return [];
    const allowed = item.streams.filter(
      (stream) => !streams.has(stableId(stream.url)),
    );
    if (allowed.length === item.streams.length) return [item];
    // Do not retain an external watch fallback for a delisted playable resource.
    return allowed.length ? [{ ...item, streams: allowed }] : [];
  });
}
