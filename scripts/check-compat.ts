// Guards the promise that this app runs on old TV engines (Chromium 68-69: Tizen 5.5, webOS 5).
// 1. No newer APIs or CSS in the source (TypeScript's lib cannot enforce this: @types/node
//    widens it, which once let a flatMap through).
// 2. The built JavaScript parses as ES2018.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Each rule applies to script files (ts/tsx) or style files (css).
const BANNED: [RegExp, string, "js" | "css"][] = [
  [/\.flat\(|\.flatMap\(/, "Array.flat/flatMap (Chromium 69)", "js"],
  [/Object\.fromEntries/, "Object.fromEntries (Chromium 73)", "js"],
  [/\.replaceAll\(/, "String.replaceAll (Chromium 85)", "js"],
  [/\.at\(-?\d/, "Array/String.at (Chromium 92)", "js"],
  [/structuredClone/, "structuredClone (Chromium 98)", "js"],
  [/AbortSignal\.(timeout|any)/, "AbortSignal.timeout/any (Chromium 103/116): use timeoutSignal()", "js"],
  [/randomUUID/, "crypto.randomUUID (Chromium 92)", "js"],
  [/Promise\.allSettled/, "Promise.allSettled (Chromium 76)", "js"],
  [/(^|[^-\w])gap\s*:/, "CSS gap (flex gap is Chromium 84)", "css"],
  [/aspect-ratio/, "CSS aspect-ratio (Chromium 88)", "css"],
  [/(^|[^-\w])inset\s*:/, "CSS inset (Chromium 87)", "css"],
  [/\b(clamp|min|max)\(/, "CSS clamp/min/max (Chromium 79)", "css"],
  [/:focus-visible/, ":focus-visible (Chromium 86)", "css"],
  [/:is\(|:where\(|:has\(/, ":is/:where/:has (Chromium 88+)", "css"],
  [/backdrop-filter/, "backdrop-filter (Chromium 76)", "css"],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
// Comments may talk about banned things; code may not.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let failed = 0;
// The website's stylesheet is for current browsers only; every other style file ships to TVs.
const WEB_ONLY_CSS = join("src", "styles", "web.css");
for (const file of walk("src")) {
  if (file === WEB_ONLY_CSS) continue;
  const code = strip(readFileSync(file, "utf8"));
  const kind = file.endsWith(".css") ? "css" : "js";
  for (const [re, why, where] of BANNED) {
    if (where !== kind) continue;
    const m = re.exec(code);
    if (m) {
      const line = code.slice(0, m.index).split("\n").length;
      console.error(`${file}:${line}  ${why}`);
      failed++;
    }
  }
}

try {
  execFileSync("npx", ["es-check", "es2018", "dist/assets/*.js", "--module"], { stdio: "inherit" });
} catch {
  failed++;
}
if (failed) {
  console.error(`\nCompatibility check failed (${failed}).`);
  process.exit(1);
}
console.log("Compatibility check passed.");
