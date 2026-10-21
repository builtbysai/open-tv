import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bundleExtension,
  DATA_DIR,
  splitExtension,
} from "../src/extension/split";

// npm run extension:split  -- extension.json outDir   a small index plus extension-data/
// npm run extension:bundle -- outDir/extension.json single.json   one self-contained file
const [command, input, output] = process.argv.slice(2);
if (!["split", "bundle"].includes(command) || !input || !output) {
  console.error(
    "Usage: extension-tools split <extension.json> <outDir> | bundle <index.json> <out.json>",
  );
  process.exit(2);
}
const json = JSON.parse(await readFile(input, "utf8"));
if (command === "split") {
  const { index, files } = splitExtension(json);
  await rm(path.join(output, DATA_DIR), { recursive: true, force: true });
  await mkdir(path.join(output, DATA_DIR), { recursive: true });
  await writeFile(path.join(output, "extension.json"), JSON.stringify(index));
  for (const file of files)
    await writeFile(path.join(output, file.path), file.content);
  const indexBytes = JSON.stringify(index).length;
  console.log(
    `index ${(indexBytes / 1e3).toFixed(0)} KB, ${files.length} data files`,
  );
  for (const f of files)
    console.log(`  ${f.path}  ${(f.content.length / 1e3).toFixed(0)} KB`);
} else {
  const dir = path.dirname(input);
  const files = new Map<string, string>();
  for (const s of json.sources ?? [])
    if (typeof s.url === "string" && !/^[a-z][a-z0-9+.-]*:/i.test(s.url))
      files.set(s.url, await readFile(path.join(dir, s.url), "utf8"));
  const out = bundleExtension(json, (p) => files.get(p) ?? "");
  await writeFile(output, JSON.stringify(out));
  console.log(`bundled ${files.size} files into ${output}`);
}
