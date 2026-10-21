import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseUpdateManifest,
  PUBLIC_CATALOG_IDS,
} from "../src/domain/catalog-updates";

export async function updateAssets(root: string, prepare = false) {
  const policy = JSON.parse(
    await readFile(path.join(root, "src/policy/restrictions.json"), "utf8"),
  );
  const files = await Promise.all(
    PUBLIC_CATALOG_IDS.map(async (id) => {
      const bytes = await readFile(
        path.join(root, `public/catalog/${id}.json`),
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return {
        id,
        bytes,
        sha256,
        path: `/catalog/releases/${id}-${sha256}.json`,
      };
    }),
  );
  const catalogs = files.map((f) => ({
    id: f.id,
    path: f.path,
    sha256: f.sha256,
    bytes: f.bytes.byteLength,
  }));
  const normalized = parseUpdateManifest({
    version: 1,
    revision: 1,
    policy,
    catalogs,
  });
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        policy: normalized.policy,
        catalogs: normalized.catalogs,
      }),
    )
    .digest("hex");
  const file = path.join(root, "src/updates/release.json");
  let previous: {
    revision?: number;
    fingerprint?: string;
    catalogs?: unknown;
    publishedAt?: string;
  } = {};
  try {
    previous = JSON.parse(await readFile(file, "utf8"));
    if (
      !previous ||
      !Number.isSafeInteger(previous.revision) ||
      Number(previous.revision) < 1 ||
      !/^[a-f0-9]{64}$/.test(previous.fingerprint || "") ||
      !Array.isArray(previous.catalogs)
    )
      throw new Error("Invalid release metadata.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        "Release metadata is unreadable. Restore src/updates/release.json from git; never reset the published revision counter.",
      );
  }
  const changed = previous.fingerprint !== fingerprint;
  if (changed && !prepare)
    throw new Error(
      "Public catalogs or policy changed. Run npm run updates:prepare and commit src/updates/release.json before building.",
    );
  const revision = changed
    ? Number.isSafeInteger(previous.revision)
      ? Number(previous.revision) + 1
      : 1
    : Number(previous.revision);
  const manifest = parseUpdateManifest({ ...normalized, revision });
  if (Buffer.byteLength(JSON.stringify(manifest)) > 1000000)
    throw new Error("The public update manifest exceeds its 1 MB limit.");
  if (changed) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        {
          revision,
          fingerprint,
          publishedAt: new Date().toISOString(),
          catalogs: manifest.catalogs,
        },
        null,
        2,
      ) + "\n",
    );
  } else if (
    JSON.stringify(previous.catalogs) !== JSON.stringify(manifest.catalogs)
  )
    throw new Error("Release descriptors do not match their source files.");
  return { manifest, files };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await updateAssets(process.cwd(), true);
  console.log(
    `Prepared public update revision ${result.manifest.revision}. No sources removed.`,
  );
}
