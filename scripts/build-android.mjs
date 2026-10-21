import { spawnSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Optional: an extension pack to bundle into the app, so it works with no network and without
// the pack being part of the repository. Pass a file, or a folder holding extension.json and
// an extension-data folder (also read from EXTENSION_PATH).
//   npm run android:debug -- --extension /path/to/pack
const flag = process.argv.indexOf("--extension");
const packPath = path.resolve(
  (flag >= 0 ? process.argv[flag + 1] : process.env.EXTENSION_PATH) || ".",
);
const withPack =
  (flag >= 0 || Boolean(process.env.EXTENSION_PATH)) && existsSync(packPath);
if ((flag >= 0 || process.env.EXTENSION_PATH) && !withPack) {
  console.error("The extension pack path does not exist.");
  process.exit(1);
}
run(npm, ["run", "build"]);
if (withPack) {
  const folder = statSync(packPath).isDirectory();
  const index = folder ? path.join(packPath, "extension.json") : packPath;
  run(npm, ["run", "extension:check", "--", index]);
  const dist = path.join(root, "dist");
  copyFileSync(index, path.join(dist, "extension.json"));
  const data = path.join(packPath, "extension-data");
  if (folder && existsSync(data))
    cpSync(data, path.join(dist, "extension-data"), { recursive: true });
}
run(
  process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  ["assembleDebug", "lintDebug", "--no-daemon"],
  path.join(root, "android"),
);
const source = path.join(
  root,
  "android/app/build/outputs/apk/debug/app-debug.apk",
);
const folder = path.join(root, "artifacts/android");
mkdirSync(folder, { recursive: true });
const apk = path.join(folder, "open-tv-google-tv-preview.apk");
copyFileSync(source, apk);
const data = readFileSync(apk),
  sha256 = createHash("sha256").update(data).digest("hex");
writeFileSync(
  path.join(folder, "SHA256SUMS"),
  `${sha256}  open-tv-google-tv-preview.apk\n`,
);
const gradle = readFileSync(
  path.join(root, "android/app/build.gradle"),
  "utf8",
);
const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const changes = spawnSync("git", ["status", "--porcelain=v1"], {
  cwd: root,
  encoding: "utf8",
});
writeFileSync(
  path.join(folder, "BUILD_INFO.json"),
  JSON.stringify(
    {
      sourceCommit: revision.status === 0 ? revision.stdout.trim() : "unknown",
      sourceHasUncommittedChanges:
        changes.status !== 0 || !!changes.stdout.trim(),
      packageId: "com.builtbysai.opentv.debug",
      versionCode: Number(gradle.match(/versionCode\s+(\d+)/)?.[1]),
      versionName: gradle.match(/versionName\s+'([^']+)'/)?.[1] + "-debug",
      minSdk: 26,
      targetSdk: 36,
      debugSigned: true,
      apkSha256: sha256,
      extensionBundled: withPack,
      physicalDeviceTested: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(`APK: ${apk}\nSHA-256: ${sha256}`);
