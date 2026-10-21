import { describe, expect, it, vi } from "vitest";
import {
  parseUpdateManifest,
  trustedUpdateUrl,
  type UpdateManifest,
} from "../src/domain/catalog-updates";
import {
  CatalogUpdateService,
  UPDATE_STORAGE_KEY,
} from "../src/updates/service";
import { queryCatalog } from "../src/domain/privacy";
import { item } from "./fixtures";

export function manifest(revision = 1, blocked: string[] = []): UpdateManifest {
  return parseUpdateManifest({
    version: 1,
    revision,
    policy: {
      blockedContentIds: blocked,
      blockedProviderIds: [],
      blockedStreamIds: [],
    },
    catalogs: ["open-cinema"].map((id) => ({
      id,
      sha256: "a".repeat(64),
      path: `/catalog/releases/${id}-${"a".repeat(64)}.json`,
      bytes: 10,
    })),
  });
}
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, text: string) => {
      values.set(key, text);
    },
  };
}
const endpoint = "https://publisher.example/catalog/update-manifest.json";
describe("trusted public updates", () => {
  it("limits endpoints, source identities, hash paths, sizes, revisions and policy fields", () => {
    expect(trustedUpdateUrl(endpoint)).toBe(endpoint);
    for (const url of [
      "http://publisher.example/a",
      "https://u:p@publisher.example/a",
      "https://publisher.example/a?token=secret",
      "javascript:alert(1)",
    ])
      expect(trustedUpdateUrl(url)).toBeNull();
    expect(
      trustedUpdateUrl("http://127.0.0.1:4173/catalog/update-manifest.json"),
    ).toBeTruthy();
    const valid = manifest();
    for (const catalog of [
      { ...valid.catalogs[0], path: "https://other.example/file" },
      { ...valid.catalogs[0], bytes: 15000001 },
      { ...valid.catalogs[0], id: "adult-vod" },
    ])
      expect(() =>
        parseUpdateManifest({
          ...valid,
          catalogs: [catalog, valid.catalogs[1]],
        }),
      ).toThrow();
    expect(() => parseUpdateManifest({ ...valid, revision: 0 })).toThrow();
    expect(() =>
      parseUpdateManifest({
        ...valid,
        policy: {
          ...valid.policy,
          blockedContentIds: ["https://private/secret"],
        },
      }),
    ).toThrow();
  });
  it("accepts higher revisions, restores policy offline and rejects rollback or conflicting content at the same revision", async () => {
    let now = 100000,
      incoming = manifest(2, ["ot-blocked"]);
    const storage = memory(),
      fetcher = vi.fn(async () => response(incoming));
    const service = new CatalogUpdateService(
      endpoint,
      manifest(),
      storage,
      fetcher,
      () => now,
    );
    await service.check();
    expect(service.snapshot.status).toBe("updated");
    const restored = new CatalogUpdateService(
      endpoint,
      manifest(),
      storage,
      fetcher,
      () => now,
    );
    expect(restored.snapshot.manifest.policy.blockedContentIds).toEqual([
      "ot-blocked",
    ]);
    incoming = manifest(1);
    now += 16000;
    await service.check(true);
    expect(service.snapshot.status).toBe("offline");
    expect(service.snapshot.manifest.revision).toBe(2);
    incoming = manifest(2, []);
    now += 16000;
    await service.check(true);
    expect(service.snapshot.manifest.policy.blockedContentIds).toEqual([
      "ot-blocked",
    ]);
    incoming = manifest(3, []);
    now += 16000;
    await service.check(true);
    expect(service.snapshot.manifest.policy.blockedContentIds).toEqual([]);
    expect(fetcher.mock.calls).toHaveLength(4);
  });
  it("isolates the cache by trusted endpoint and ignores older or malformed state after a new app build", async () => {
    const storage = memory(),
      service = new CatalogUpdateService(
        endpoint,
        manifest(),
        storage,
        async () => response(manifest(2, ["ot-blocked"])),
      );
    await service.check();
    expect(
      new CatalogUpdateService(
        "https://other.example/catalog/update-manifest.json",
        manifest(),
        storage,
      ).snapshot.manifest.revision,
    ).toBe(1);
    expect(
      new CatalogUpdateService(endpoint, manifest(3, ["ot-newbuild"]), storage)
        .snapshot.manifest.policy.blockedContentIds,
    ).toEqual(["ot-newbuild"]);
    storage.setItem(UPDATE_STORAGE_KEY, "broken JSON");
    expect(
      new CatalogUpdateService(endpoint, manifest(3), storage).snapshot.manifest
        .revision,
    ).toBe(3);
  });
  it("coalesces requests, bounds manual requests and uses backoff without credentials or sensitive request data", async () => {
    let now = 100000;
    const fetcher = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response("not JSON", { status: 503 }),
    );
    const service = new CatalogUpdateService(
      endpoint,
      manifest(),
      memory(),
      fetcher,
      () => now,
    );
    const first = service.check(),
      second = service.check();
    expect(first).toBe(second);
    await first;
    expect(service.snapshot.nextCheckAt).toBe(now + 60000);
    await service.check(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 16000;
    await service.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 45000;
    await service.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(service.snapshot.nextCheckAt).toBe(now + 120000);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
  });
  it("ignores late results after suspension and keeps a newer cross-tab policy while a stale request completes", async () => {
    let resolve!: (value: Response) => void,
      now = 100000;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((accept) => {
          resolve = accept;
        }),
    );
    const storage = memory(),
      service = new CatalogUpdateService(
        endpoint,
        manifest(),
        storage,
        fetcher,
        () => now,
      );
    const pending = service.check();
    await Promise.resolve();
    service.cancel();
    resolve(response(manifest(9)));
    await pending;
    expect(service.snapshot.manifest.revision).toBe(1);
    expect(service.snapshot.failures).toBe(0);
    now += 16000;
    const next = service.check();
    await Promise.resolve();
    storage.setItem(
      UPDATE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        endpoint,
        manifest: manifest(4, ["ot-new"]),
        checkedAt: now,
      }),
    );
    service.restore();
    resolve(response(manifest(2)));
    await next;
    expect(service.snapshot.manifest.revision).toBe(4);
    expect(
      queryCatalog([item({ id: "ot-new" })], {
        policy: service.snapshot.manifest.policy,
      }),
    ).toEqual([]);
  });
  it("does not lose restrictions on storage errors, missing endpoints, failed JSON, or deleted cache records", async () => {
    const storage = {
      getItem: () => {
        throw new Error();
      },
      setItem: () => {
        throw new Error();
      },
    };
    const service = new CatalogUpdateService(
      endpoint,
      manifest(2, ["ot-retained"]),
      storage,
      async () => response(manifest(3, ["ot-retained"])),
    );
    await service.check();
    service.restore();
    expect(service.snapshot.manifest.revision).toBe(3);
    const disabled = new CatalogUpdateService(
      null,
      manifest(2, ["ot-retained"]),
      storage,
    );
    await disabled.check();
    expect(disabled.snapshot.status).toBe("disabled");
    expect(disabled.snapshot.manifest.policy.blockedContentIds).toEqual([
      "ot-retained",
    ]);
  });
});
