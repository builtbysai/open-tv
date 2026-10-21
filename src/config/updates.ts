import {
  parseUpdateManifest,
  trustedUpdateUrl,
} from "../domain/catalog-updates";
import release from "../updates/release.json";
import policy from "../policy/restrictions.json";
import type { Source } from "../domain/content";
import type { UpdateManifest } from "../domain/catalog-updates";
import type { PublicCatalogUpdate } from "../providers/catalog";
import { mediaUrl } from "../domain/urls";
import { appAsset, publicSiteUrl } from "./site";
// Release paths are written from the site root (/catalog/releases/…); the manifest sits
// in /catalog/ beside them, so the site root is one level up from it.
export const releaseUrl = (path: string, endpoint: string) =>
  new URL(`../${path.replace(/^\/+/, "")}`, endpoint).href;
export const bundledManifest = parseUpdateManifest({
  version: 1,
  revision: release.revision,
  catalogs: release.catalogs,
  policy,
});
export function updateEndpoint(): string | null {
  if (import.meta.env.VITE_CATALOG_UPDATE_URL === "disabled") return null;
  const configured = import.meta.env.VITE_CATALOG_UPDATE_URL;
  const base = publicSiteUrl();
  return trustedUpdateUrl(
    configured || new URL("catalog/update-manifest.json", base).href,
  );
}
export function updateStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
export function publicCatalogUpdate(
  source: Source,
  manifest: UpdateManifest,
  endpoint: string | null,
): PublicCatalogUpdate | undefined {
  const baseline = bundledManifest.catalogs.find(
    (entry) => entry.id === source.id,
  );
  if (
    !baseline ||
    source.kind !== "catalog" ||
    source.classification !== "general" ||
    mediaUrl(source.url || "", location.href) !==
      mediaUrl(appAsset(`/catalog/${source.id}.json`), location.href)
  )
    return;
  const release = manifest.catalogs.find((entry) => entry.id === source.id)!;
  return {
    baseline,
    revision: manifest.revision,
    remote:
      endpoint && release.sha256 !== baseline.sha256
        ? { release, url: releaseUrl(release.path, endpoint) }
        : undefined,
  };
}
