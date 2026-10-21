import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { updateAssets } from "../scripts/update-assets";
it("builds deterministic content-addressed releases and requires a reviewed revision bump after source/policy changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "open-tv-updates-"));
  try {
    await mkdir(path.join(root, "src/policy"), { recursive: true });
    await mkdir(path.join(root, "public/catalog"), { recursive: true });
    const policy = {
      version: 1,
      blockedContentIds: [],
      blockedProviderIds: [],
      blockedStreamIds: [],
    };
    await writeFile(
      path.join(root, "src/policy/restrictions.json"),
      JSON.stringify(policy),
    );
    for (const id of ["open-cinema"])
      await writeFile(
        path.join(root, `public/catalog/${id}.json`),
        '{"items":[]}',
      );
    await expect(updateAssets(root)).rejects.toThrow(/updates:prepare/);
    const first = await updateAssets(root, true),
      again = await updateAssets(root, true);
    expect(first.manifest).toEqual(again.manifest);
    expect(first.manifest.revision).toBe(1);
    expect((await updateAssets(root)).manifest).toEqual(first.manifest);
    await writeFile(
      path.join(root, "src/policy/restrictions.json"),
      JSON.stringify({ ...policy, blockedContentIds: ["ot-review"] }),
    );
    await expect(updateAssets(root)).rejects.toThrow(/updates:prepare/);
    const second = await updateAssets(root, true);
    expect(second.manifest.revision).toBe(2);
    expect(second.manifest.catalogs).toEqual(first.manifest.catalogs);
    expect(
      await readFile(
        path.join(root, "public/catalog/open-cinema.json"),
        "utf8",
      ),
    ).toBe('{"items":[]}');
    await writeFile(path.join(root, "src/updates/release.json"), "broken JSON");
    await expect(updateAssets(root, true)).rejects.toThrow(/never reset/);
    await writeFile(
      path.join(root, "src/updates/release.json"),
      JSON.stringify({
        revision: 0,
        fingerprint: "a".repeat(64),
        catalogs: [],
      }),
    );
    await expect(updateAssets(root, true)).rejects.toThrow(/never reset/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
