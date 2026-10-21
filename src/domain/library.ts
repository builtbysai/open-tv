import type { Content } from "./content";
import { persistableUrl } from "./urls";
import { appAsset } from "../config/site";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bundled = new RegExp(
  `^(?:/|${escape(appAsset("/"))})artwork/[a-z0-9.-]+$|^/artwork/[a-z0-9.-]+$`,
);
export const bundledArtwork = (url: string) => bundled.test(url);
export function canPersistContent(item: Content): boolean {
  const artwork = (url?: string) =>
    !url || bundledArtwork(url) || persistableUrl(url);
  return (
    item.streams.every((s) => persistableUrl(s.url)) &&
    artwork(item.artwork) &&
    artwork(item.backdrop) &&
    (!item.externalUrl || persistableUrl(item.externalUrl)) &&
    (!item.rights.url || persistableUrl(item.rights.url))
  );
}
// Editing preserves identity; URL changes do not erase favorites, progress or collection membership.
export function upsertMedia(items: Content[], additions: Content[]): Content[] {
  const map = new Map(items.map((item) => [item.id, item]));
  for (const item of additions)
    map.set(item.id, { ...item, providerId: "personal-media" });
  return [...map.values()];
}
