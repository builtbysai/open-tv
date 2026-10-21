import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// npm run check:keys -- [dir…]   (npm run check runs it on public/ and the builds)
// A TMDB v3 key is 32 hex characters, and a shipped file must never hold one. The only 32-hex
// runs allowed are whole path segments of an address (".../701126…/index.m3u8"), which are
// stream ids, not keys.
const HEX32 = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi;
const TEXT =
  /\.(?:js|mjs|css|html|json|m3u8?|xml|txt|svg|webmanifest|map)$|^_headers$/i;

// Public DRM system ids the player library names (Widevine, PlayReady, ClearKey, FairPlay).
const KNOWN = new Set([
  "edef8ba979d64acea3c827dcd51d21ed",
  "9a04f07998404286ab92e65be0885f95",
  "e2719d58a985b3c9781ab030af78d30e",
  "1077efecc0b24d02ace33c1e52e2fb4b",
  "94ce86fb07ff4f43adb893d2fa968ca2",
]);

export function keysIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(HEX32)) {
    const before = text[match.index - 1];
    const after = text[match.index + match[0].length];
    if (before === "/" && after === "/") continue;
    if (KNOWN.has(match[0].toLowerCase())) continue;
    found.push(match[0]);
  }
  return found;
}
export async function scanForKeys(
  dir: string,
): Promise<{ file: string; key: string }[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  const hits: { file: string; key: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !TEXT.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    for (const key of keysIn(await readFile(file, "utf8")))
      hits.push({ file, key: `${key.slice(0, 4)}…` });
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  const hits = (
    await Promise.all(
      (dirs.length ? dirs : ["public", "dist"]).map(scanForKeys),
    )
  ).flat();
  for (const hit of hits)
    console.error(`${hit.file}: looks like a TMDB key (${hit.key})`);
  if (hits.length) process.exit(1);
  console.log("No TMDB keys in shipped files.");
}
