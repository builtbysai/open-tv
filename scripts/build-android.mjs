// Builds the web app, then the Android TV debug APK that wraps it, and writes the APK,
// its checksum and build info to artifacts/android/.   npm run android:debug
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const win = process.platform === "win32";
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: win });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(win ? "npm.cmd" : "npm", ["run", "build"]);
run(win ? "gradlew.bat" : "./gradlew", ["assembleDebug", "lintDebug", "--no-daemon"], path.join(root, "android"));

const out = path.join(root, "artifacts/android");
mkdirSync(out, { recursive: true });
const apk = path.join(out, "open-tv-android-tv-debug.apk");
copyFileSync(path.join(root, "android/app/build/outputs/apk/debug/app-debug.apk"), apk);
const sha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
writeFileSync(path.join(out, "SHA256SUMS"), `${sha256}  open-tv-android-tv-debug.apk\n`);

const gradle = readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const revision = git(["rev-parse", "HEAD"]);
const changes = git(["status", "--porcelain=v1"]);
writeFileSync(
  path.join(out, "BUILD_INFO.json"),
  JSON.stringify(
    {
      sourceCommit: revision.status === 0 ? revision.stdout.trim() : "unknown",
      sourceHasUncommittedChanges: changes.status !== 0 || !!changes.stdout.trim(),
      versionCode: Number(gradle.match(/versionCode\s+(\d+)/)?.[1]),
      versionName: gradle.match(/versionName\s+'([^']+)'/)?.[1] + "-debug",
      debugSigned: true,
      apkSha256: sha256,
      physicalDeviceTested: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(`APK: ${apk}\nSHA-256: ${sha256}`);
