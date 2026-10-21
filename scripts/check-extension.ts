import { readFile } from "node:fs/promises";
import path from "node:path";
import { MAX_EXTENSION_BYTES, parseExtension } from "../src/extension/format";
import { validateContent } from "../src/providers/catalog";

// npm run extension:check -- path/to/extension.json
// Reads an extension the way the app does, follows the data files next to it, and says what
// it would add.
const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run extension:check -- <extension.json>");
  process.exit(2);
}
const BASE = "https://extension.invalid/";
const text = await readFile(file, "utf8");
if (text.length > MAX_EXTENSION_BYTES) {
  console.error("Too large: the app refuses files over 60 MB.");
  process.exit(1);
}
try {
  const ext = parseExtension(text, BASE);
  const total = (JSON.parse(text).sources ?? []).length;
  const adult = ext.sources.filter((s) => s.classification === "adult").length;
  let problems = 0;
  let dataBytes = 0;
  for (const s of ext.sources) {
    if (!s.url?.startsWith(BASE)) continue;
    const local = path.join(path.dirname(file), s.url.slice(BASE.length));
    try {
      const body = await readFile(local, "utf8");
      dataBytes += body.length;
      const count =
        s.kind === "catalog"
          ? validateContent(JSON.parse(body).items).length
          : (body.match(/^#EXTINF/gm) ?? []).length;
      if (!count) throw new Error("it has no entries");
    } catch (error) {
      problems++;
      console.error(
        `  ${s.id}: ${s.url.slice(BASE.length)} is unusable (${error instanceof Error ? error.message : "unreadable"})`,
      );
    }
  }
  console.log(
    `${ext.name}: index ${(text.length / 1e3).toFixed(0)} KB` +
      (dataBytes ? `, data files ${(dataBytes / 1e6).toFixed(1)} MB` : ""),
  );
  console.log(
    `  sources: ${ext.sources.length} usable of ${total} (${adult} 18+)`,
  );
  console.log(`  music instances: ${ext.musicProviders.length}`);
  console.log(`  servers: ${ext.servers.length}`);
  console.log(`  suggested guides: ${ext.guides.length}`);
  const rawKey = JSON.parse(text).tmdbKey;
  console.log(
    `  TMDB key: ${ext.tmdbKey ? "yes" : rawKey ? "placeholder or invalid, ignored (replace it with your key)" : "no"}`,
  );
  console.log(`  profile: ${ext.profile ? "yes" : "no"}`);
  if (ext.sources.length < total)
    console.warn(`  ${total - ext.sources.length} source(s) would be skipped.`);
  if (ext.tmdbKey || ext.profile)
    console.warn(
      "  Contains a key or profile: do not serve this file from a public site.",
    );
  if (problems) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
