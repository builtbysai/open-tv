import { normalizeCountries, normalizeLanguages } from "../domain/languages";
import type { Content, Source } from "../domain/content";
import { deduplicate } from "../domain/content";
import { mediaUrl } from "../domain/urls";
import { classify } from "../domain/privacy";
import { limitedText, sourceFetch } from "./http";
import { M3UProvider, parseM3U } from "./m3u";
import { getCached, putCached } from "../persistence/catalog-cache";
import { AppError } from "../domain/errors";
import { appAsset } from "../config/site";
import { bundledArtwork } from "../domain/library";
import type { CatalogRelease } from "../domain/catalog-updates";
import { clipText } from "../domain/text";
export interface PublicCatalogUpdate {
  baseline: CatalogRelease;
  revision: number;
  remote?: { release: CatalogRelease; url: string };
}
export async function verifyCatalogText(
  text: string,
  release: CatalogRelease,
): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength !== release.bytes)
    throw new AppError(
      "format",
      "Catalog verification failed. Keeping the last available catalog.",
    );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (hex !== release.sha256)
    throw new AppError(
      "format",
      "Catalog verification failed. Keeping the last available catalog.",
    );
}
async function loadPublicRelease(
  source: Source,
  update: PublicCatalogUpdate,
  signal?: AbortSignal,
  force = false,
  cacheable = true,
) {
  const { release, url } = update.remote!;
  // One replaceable entry per built-in catalog, not one growing database entry per revision.
  const key = `public:${source.id}`;
  const cached = cacheable ? await getCached(key) : undefined;
  const validCache =
    cached &&
    Array.isArray(cached.items) &&
    /^[a-f0-9]{64}$/.test(cached.sha256 || "") &&
    Number.isSafeInteger(cached.revision) &&
    cached.revision! <= update.revision
      ? cached
      : undefined;
  if (!force && validCache?.sha256 === release.sha256)
    return {
      items: validateContent(validCache.items),
      freshness: "cached" as const,
    };
  try {
    const response = await sourceFetch(url, {
      signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: force ? "reload" : "force-cache",
    });
    if (
      !response.ok ||
      !/^application\/json(?:;|$)/i.test(
        response.headers.get("content-type") || "",
      )
    )
      throw new Error();
    const text = await limitedText(response, release.bytes);
    await verifyCatalogText(text, release);
    signal?.throwIfAborted();
    const data = JSON.parse(text);
    const items = deduplicate(
      validateContent(data.items).filter(
        (item) =>
          item.providerId === source.id &&
          item.classification === "general" &&
          !item.serverId,
      ),
    );
    if (cacheable)
      await putCached(key, items, {
        sha256: release.sha256,
        revision: update.revision,
      });
    return { items, freshness: "fresh" as const };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (validCache)
      return {
        items: validateContent(validCache.items),
        freshness: "stale" as const,
      };
    // The original bundled/same-origin source remains available when an update fails.
    const fallback = await loadSource(source, signal, force, cacheable, {
      ...update,
      remote: undefined,
    });
    return { ...fallback, freshness: "bundled" as const };
  }
}
// Validate remote/static JSON at the trust boundary; React never renders provider HTML.
function safeArtwork(value?: string): string | undefined {
  // Bundled artwork is written as /artwork/x.webp and served under the site base path.
  if (value && /^\/artwork\/[a-z0-9.-]+$/.test(value)) return appAsset(value);
  if (value && value.startsWith(appAsset("/artwork/")) && bundledArtwork(value))
    return value;
  return mediaUrl(value || "") || undefined;
}
export function validateContent(value: unknown): Content[] {
  if (!Array.isArray(value))
    throw new AppError("format", "The catalog has an invalid format.");
  return value
    .filter(
      (item): item is Content =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        /^ot-[a-z0-9]+$/.test(item.id) &&
        typeof item.title === "string" &&
        typeof item.providerId === "string" &&
        (item.serverId === undefined ||
          (typeof item.serverId === "string" &&
            /^ot-[a-z0-9]{1,60}$/.test(item.serverId) &&
            typeof item.providerItemId === "string" &&
            /^[a-z0-9_-]{1,100}$/i.test(item.providerItemId))) &&
        [
          "live",
          "movie",
          "series",
          "episode",
          "anime",
          "documentary",
          "radio",
          "audio",
        ].includes(item.type) &&
        ["general", "adult", "unknown"].includes(item.classification) &&
        ["playable", "external", "unavailable"].includes(item.availability) &&
        ["genres", "languages", "countries"].every(
          (k) =>
            Array.isArray(item[k]) &&
            item[k].every((v: unknown) => typeof v === "string"),
        ) &&
        Array.isArray(item.streams) &&
        item.streams.every(
          (s: { url: string; format: string }) =>
            s &&
            !!mediaUrl(s.url) &&
            ["hls", "video", "audio", "embed"].includes(s.format),
        ) &&
        !!item.rights &&
        [
          "open-license",
          "public-domain",
          "provider-listed",
          "user-authorized",
          "unverified",
        ].includes(item.rights.status),
    )
    .map((item) => ({
      id: item.id,
      providerId: item.providerId.slice(0, 100),
      serverId:
        typeof item.serverId === "string" &&
        /^ot-[a-z0-9]{1,60}$/.test(item.serverId)
          ? item.serverId
          : undefined,
      providerItemId:
        typeof item.providerItemId === "string"
          ? item.providerItemId.slice(0, 200)
          : undefined,
      aliases: Array.isArray(item.aliases)
        ? item.aliases
            .filter(
              (id) => typeof id === "string" && /^ot-[a-z0-9]{1,60}$/.test(id),
            )
            .slice(0, 30)
        : [],
      title: item.title.slice(0, 300),
      type: item.type,
      description:
        typeof item.description === "string"
          ? clipText(item.description, 20000)
          : undefined,
      classification: classify(
        `${item.title} ${item.genres.join(" ")}`,
        item.classification,
      ),
      artwork: safeArtwork(item.artwork),
      backdrop: safeArtwork(item.backdrop),
      externalUrl: mediaUrl(item.externalUrl || "") || undefined,
      availability:
        item.availability === "playable" && !item.streams.length
          ? "unavailable"
          : item.availability,
      genres: item.genres.slice(0, 30),
      languages: normalizeLanguages(item.languages).slice(0, 30),
      countries: normalizeCountries(item.countries).slice(0, 30),
      streams: item.streams.slice(0, 20).map((stream) => ({
        url: stream.url,
        format: stream.format,
        quality:
          typeof stream.quality === "string"
            ? stream.quality.slice(0, 40)
            : undefined,
        health: ["reachable", "unreachable", "unchecked"].includes(
          stream.health || "",
        )
          ? stream.health
          : "unchecked",
        checkedAt:
          typeof stream.checkedAt === "string" ? stream.checkedAt : undefined,
      })),
      rights: {
        status: item.rights.status,
        license:
          typeof item.rights.license === "string"
            ? item.rights.license.slice(0, 200)
            : undefined,
        attribution:
          typeof item.rights.attribution === "string"
            ? item.rights.attribution.slice(0, 1000)
            : undefined,
        url: mediaUrl(item.rights.url || "") || undefined,
        regions: Array.isArray(item.rights.regions)
          ? item.rights.regions
              .filter((r) => typeof r === "string")
              .slice(0, 100)
          : undefined,
      },
      year:
        typeof item.year === "number" && Number.isFinite(item.year)
          ? item.year
          : undefined,
      tmdbId:
        typeof item.tmdbId === "number" &&
        Number.isSafeInteger(item.tmdbId) &&
        item.tmdbId > 0
          ? item.tmdbId
          : undefined,
      addedAt:
        typeof item.addedAt === "number" &&
        Number.isFinite(item.addedAt) &&
        item.addedAt > 0
          ? item.addedAt
          : undefined,
      duration:
        typeof item.duration === "number" &&
        item.duration > 0 &&
        Number.isFinite(item.duration)
          ? item.duration
          : undefined,
      seriesId:
        typeof item.seriesId === "string" &&
        /^ot-[a-z0-9]+$/.test(item.seriesId)
          ? item.seriesId
          : undefined,
      season:
        typeof item.season === "number" &&
        Number.isInteger(item.season) &&
        item.season >= 0
          ? item.season
          : undefined,
      episode:
        typeof item.episode === "number" &&
        Number.isInteger(item.episode) &&
        item.episode > 0
          ? item.episode
          : undefined,
      epgId:
        typeof item.epgId === "string" ? item.epgId.slice(0, 200) : undefined,
    }));
}
import { directoryProvider } from "./directories";
import { inlineData } from "../extension/store";
export async function loadSource(
  source: Source,
  signal?: AbortSignal,
  force = false,
  allowPersistence = true,
  update?: PublicCatalogUpdate,
): Promise<{
  items: Content[];
  freshness: "cached" | "fresh" | "stale" | "bundled";
}> {
  const cacheable =
    allowPersistence &&
    !source.inline &&
    source.kind !== "xtream" &&
    source.kind !== "library";
  if (update?.remote && source.kind === "catalog")
    return loadPublicRelease(source, update, signal, force, cacheable);
  const cached = cacheable ? await getCached(source.id) : undefined;
  if (
    !force &&
    cached &&
    (!update || cached.sha256 === update.baseline.sha256) &&
    Date.now() - cached.at < source.refreshHours * 3600000
  )
    return { items: cached.items, freshness: "cached" };
  try {
    let items: Content[];
    if (source.inline) {
      // Carried inside an extension file already on this device.
      const data = inlineData(source.id);
      if (!data)
        throw new AppError(
          "format",
          "This extension source is no longer on this device. Import the extension again.",
        );
      items =
        source.kind === "catalog"
          ? validateContent(data.items)
          : parseM3U(data.m3u || "", source);
    } else if (source.kind === "directory") {
      items = await directoryProvider(source).load(signal);
    } else if (source.kind === "catalog") {
      const response = await sourceFetch(source.url!, {
        signal,
        credentials: "omit",
      });
      if (!response.ok)
        throw new AppError(
          "network",
          "This catalog is temporarily unavailable.",
        );
      const data = JSON.parse(await limitedText(response));
      items = validateContent(data.items);
    } else
      items = await new M3UProvider({
        ...source,
        url: new URL(source.url!, location.href).href,
      }).load(signal);
    items = deduplicate(items);
    // A refresh that comes back far smaller than the last good copy is a partial answer
    // (rate limit, outage), not news: keep what we had instead of shrinking the list.
    if (
      cached &&
      cached.items.length >= 10 &&
      items.length < cached.items.length * 0.6
    )
      return { items: cached.items, freshness: "stale" };
    if (cacheable)
      await putCached(
        source.id,
        items,
        update && { sha256: update.baseline.sha256 },
      );
    return { items, freshness: "fresh" };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (cached) return { items: cached.items, freshness: "stale" };
    throw error;
  }
}
