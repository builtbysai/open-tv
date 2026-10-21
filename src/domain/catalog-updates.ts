import type { ContentPolicy } from "./content-policy";

export const PUBLIC_CATALOG_IDS = ["open-cinema"] as const;
export interface CatalogRelease {
  id: (typeof PUBLIC_CATALOG_IDS)[number];
  path: string;
  sha256: string;
  bytes: number;
}
export interface UpdateManifest {
  version: 1;
  revision: number;
  policy: ContentPolicy;
  catalogs: CatalogRelease[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function parseUpdateManifest(value: unknown): UpdateManifest {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !record(value.policy) ||
    !Array.isArray(value.catalogs) ||
    value.catalogs.length !== PUBLIC_CATALOG_IDS.length
  )
    throw new Error("Invalid public update manifest.");
  const identifiers = (field: string, pattern: RegExp): string[] => {
    const values = (value.policy as Record<string, unknown>)[field];
    if (
      !Array.isArray(values) ||
      values.length > 10000 ||
      values.some((v) => typeof v !== "string" || !pattern.test(v))
    )
      throw new Error("Invalid content restriction identifiers.");
    return [...new Set(values as string[])].sort();
  };
  const seen = new Set<string>();
  const catalogs = value.catalogs
    .map((entry): CatalogRelease => {
      if (
        !record(entry) ||
        !PUBLIC_CATALOG_IDS.includes(entry.id as CatalogRelease["id"]) ||
        seen.has(String(entry.id)) ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) ||
        Number(entry.bytes) <= 0 ||
        Number(entry.bytes) > 15000000 ||
        entry.path !== `/catalog/releases/${entry.id}-${entry.sha256}.json`
      )
        throw new Error("Invalid public catalog release.");
      seen.add(String(entry.id));
      return {
        id: entry.id as CatalogRelease["id"],
        path: String(entry.path),
        sha256: entry.sha256,
        bytes: Number(entry.bytes),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1,
    revision: Number(value.revision),
    policy: {
      blockedContentIds: identifiers(
        "blockedContentIds",
        /^ot-[a-z0-9]{1,60}$/,
      ),
      blockedProviderIds: identifiers(
        "blockedProviderIds",
        /^[a-z0-9_-]{1,100}$/i,
      ),
      blockedStreamIds: identifiers("blockedStreamIds", /^ot-[a-z0-9]{1,60}$/),
    },
    catalogs,
  };
}
export function sameManifest(a: UpdateManifest, b: UpdateManifest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function trustedUpdateUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
