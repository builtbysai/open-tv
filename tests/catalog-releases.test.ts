import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  loadSource,
  verifyCatalogText,
  type PublicCatalogUpdate,
} from "../src/providers/catalog";
import { clearCatalogCache, getCached } from "../src/persistence/catalog-cache";
import type { Content, Source } from "../src/domain/content";
import type { CatalogRelease } from "../src/domain/catalog-updates";
import { item } from "./fixtures";
const source: Source = {
  id: "open-cinema",
  kind: "catalog",
  url: "https://bundled.example/catalog/open-cinema.json",
  name: "Public directory",
  enabled: true,
  classification: "general",
  refreshHours: 24,
  description: "Fixture",
};
function payload(items: Content[]) {
  const text = JSON.stringify({ version: 1, items }),
    sha256 = createHash("sha256").update(text).digest("hex");
  const release: CatalogRelease = {
    id: "open-cinema",
    path: `/catalog/releases/open-cinema-${sha256}.json`,
    sha256,
    bytes: Buffer.byteLength(text),
  };
  return { text, release };
}
const general = (patch: Partial<Content> = {}) =>
  item({
    id: "ot-release",
    providerId: "open-cinema",
    title: "日本語 channel",
    ...patch,
  });
const jsonResponse = (text: string) =>
  new Response(text, { headers: { "content-type": "application/json" } });
function update(release: CatalogRelease): PublicCatalogUpdate {
  return {
    baseline: { ...release, sha256: "a".repeat(64) },
    revision: 2,
    remote: { release, url: "https://publisher.example" + release.path },
  };
}
beforeEach(async () => {
  await clearCatalogCache().catch(() => {});
});
afterEach(() => vi.unstubAllGlobals());
it("verifies exact UTF-8 bytes and excludes restricted/foreign/server records from public releases", async () => {
  const data = payload([
    general(),
    general({ id: "ot-adult", classification: "adult" }),
    general({ id: "ot-foreign", providerId: "account" }),
    general({ id: "ot-server", serverId: "ot-server", providerItemId: "film" }),
  ]);
  expect(data.text.length).toBeLessThan(data.release.bytes);
  await expect(
    verifyCatalogText(data.text, data.release),
  ).resolves.toBeUndefined();
  await expect(
    verifyCatalogText(data.text + " ", data.release),
  ).rejects.toThrow(/verification failed/);
  await expect(
    verifyCatalogText(data.text, { ...data.release, sha256: "b".repeat(64) }),
  ).rejects.toThrow(/verification failed/);
  const fetcher = vi.fn(async () => jsonResponse(data.text));
  vi.stubGlobal("fetch", fetcher);
  const result = await loadSource(
    source,
    undefined,
    false,
    true,
    update(data.release),
  );
  expect(result.items.map((c) => c.id)).toEqual(["ot-release"]);
  expect(fetcher.mock.calls).toHaveLength(1);
  const cached = await loadSource(
    source,
    undefined,
    false,
    true,
    update(data.release),
  );
  expect(cached.freshness).toBe("cached");
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(await getCached("public:open-cinema")).toMatchObject({
    sha256: data.release.sha256,
    revision: 2,
  });
});
it("retains verified cached content on corruption and falls back to bundled content when no verified update exists", async () => {
  const valid = payload([general()]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(valid.text)),
  );
  await loadSource(source, undefined, false, true, update(valid.release));
  const corrupt = payload([general({ title: "corrupted" })]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(corrupt.text)),
  );
  const cached = await loadSource(
    source,
    undefined,
    true,
    true,
    update(valid.release),
  );
  expect(cached.freshness).toBe("stale");
  expect(cached.items[0].title).toBe("日本語 channel");
  await clearCatalogCache().catch(() => {});
  const fetcher = vi.fn(async (url: string) =>
    url === source.url
      ? jsonResponse(payload([general({ title: "Bundled fallback" })]).text)
      : jsonResponse(corrupt.text),
  );
  vi.stubGlobal("fetch", fetcher);
  const fallback = await loadSource(
    source,
    undefined,
    false,
    true,
    update(valid.release),
  );
  expect(fallback.freshness).toBe("bundled");
  expect(fallback.items[0].title).toBe("Bundled fallback");
  expect(await getCached("public:open-cinema")).toBeUndefined();
});
it("replaces one cache entry across revisions instead of refetching or accumulating old snapshots", async () => {
  const first = payload([general()]),
    second = payload([general({ title: "Updated" })]);
  let incoming = first;
  const fetcher = vi.fn(async () => jsonResponse(incoming.text));
  vi.stubGlobal("fetch", fetcher);
  await loadSource(source, undefined, false, true, update(first.release));
  incoming = second;
  await loadSource(source, undefined, false, true, {
    ...update(second.release),
    revision: 3,
  });
  expect((await getCached("public:open-cinema"))?.items[0].title).toBe(
    "Updated",
  );
  expect((await getCached("public:open-cinema"))?.revision).toBe(3);
  await loadSource(source, undefined, false, true, {
    ...update(second.release),
    revision: 3,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not persist private-scope updates or accept an authorization result after cancellation", async () => {
  const valid = payload([general()]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(valid.text)),
  );
  await loadSource(source, undefined, false, false, update(valid.release));
  expect(await getCached("public:open-cinema")).toBeUndefined();
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadSource(source, controller.signal, false, true, update(valid.release)),
  ).rejects.toThrow();
  expect(await getCached("public:open-cinema")).toBeUndefined();
});
