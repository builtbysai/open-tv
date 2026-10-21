import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseUpdateManifest } from "../src/domain/catalog-updates";
import { limitedText } from "../src/providers/http";

import site from "../site.config.json";

const input = new URL(process.argv[2] || site.url);
if (!input.pathname.endsWith("/")) input.pathname += "/";
if (
  input.protocol !== "https:" ||
  input.username ||
  input.password ||
  input.search ||
  input.hash
)
  throw new Error(
    "Use a public HTTPS site address without credentials, query or fragment.",
  );
// The site may live under a sub-path such as /open-tv/, so every path is joined to it.
const origin = input.href.replace(/\/$/, "");
const checks: { check: string; passed: boolean; detail: string }[] = [];
const add = (check: string, passed: boolean, detail: string) =>
  checks.push({ check, passed, detail });
const fetchPublic = (path: string, method = "GET") =>
  fetch(`${origin}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
try {
  const root = await fetchPublic("/");
  const html = await limitedText(root, 1000000);
  add(
    "viewer",
    root.ok &&
      /id=["']root["']/.test(html) &&
      /assets\/(?:index|main)-[^"']+\.js/.test(html),
    "Root serves the compiled viewer, rather than raw TypeScript or the prototype.",
  );
  // Static hosts such as GitHub Pages cannot send headers, so the policy ships as a meta tag.
  const csp =
    root.headers.get("content-security-policy") ||
    html.match(
      /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ||
    "";
  add(
    "content security policy",
    csp.includes("object-src") && csp.includes("script-src"),
    "A content security policy is delivered by header or meta tag.",
  );
  const asset = html.match(
    /src=["']([^"']*\/assets\/(?:index|main)-[^"']+\.js)["']/,
  )?.[1];
  if (asset) {
    const response = await fetch(new URL(asset, input), {
      method: "HEAD",
      signal: AbortSignal.timeout(10000),
    });
    add(
      "viewer script",
      response.ok &&
        /javascript/.test(response.headers.get("content-type") || ""),
      "Hashed viewer JavaScript is reachable under the site path.",
    );
  }
} catch {
  add(
    "viewer request",
    false,
    "Root could not be checked within the request deadline.",
  );
}
try {
  const response = await fetchPublic("/catalog/update-manifest.json");
  if (
    !response.ok ||
    !/^application\/json(?:;|$)/i.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new Error();
  const manifest = parseUpdateManifest(
    JSON.parse(await limitedText(response, 1000000)),
  );
  const local = JSON.parse(await readFile("src/updates/release.json", "utf8"));
  add(
    "update manifest",
    manifest.revision >= local.revision,
    `Published revision ${manifest.revision}; repository revision ${local.revision}.`,
  );
  add(
    "manifest headers",
    response.headers.get("access-control-allow-origin") === "*",
    "Installed TV previews can read public update information.",
  );
  const results = await Promise.allSettled(
    manifest.catalogs.map(async (catalog) => {
      // Verify one small snapshot fully. HEAD the large directory rather than
      // downloading its multi-megabyte body for a deployment smoke check.
      const small = catalog.id === "open-cinema";
      const remote = await fetchPublic(catalog.path, small ? "GET" : "HEAD");
      const valid =
        remote.ok &&
        /^application\/json(?:;|$)/i.test(
          remote.headers.get("content-type") || "",
        ) &&
        remote.headers.get("access-control-allow-origin") === "*";
      if (!small)
        return {
          check: `snapshot ${catalog.id}`,
          passed: valid,
          detail: "Large snapshot reachable and readable cross-origin.",
        };
      const bytes = Buffer.from(await limitedText(remote, 1000000));
      return {
        check: `snapshot ${catalog.id}`,
        passed:
          valid &&
          bytes.length === catalog.bytes &&
          createHash("sha256").update(bytes).digest("hex") === catalog.sha256,
        detail: "Small snapshot SHA-256, byte count and CORS verified.",
      };
    }),
  );
  for (const [i, result] of results.entries())
    checks.push(
      result.status === "fulfilled"
        ? result.value
        : {
            check: `snapshot ${manifest.catalogs[i].id}`,
            passed: false,
            detail: "Snapshot request failed or exceeded its limit.",
          },
    );
} catch {
  add(
    "update manifest",
    false,
    "Missing/invalid JSON manifest. A 200 HTML SPA fallback does not activate catalog updates.",
  );
}
for (const name of ["movies", "news"]) {
  try {
    const response = await fetchPublic(`/playlists/${name}.m3u`, "HEAD");
    add(
      `bundled playlist ${name}`,
      response.ok &&
        !/text\/html/i.test(response.headers.get("content-type") || ""),
      "Bundled playlist is available.",
    );
  } catch {
    add(`bundled playlist ${name}`, false, "Playlist endpoint unavailable.");
  }
}
console.log(
  JSON.stringify(
    {
      origin,
      checkedAt: new Date().toISOString(),
      passed: checks.every((check) => check.passed),
      checks,
    },
    null,
    2,
  ),
);
if (checks.some((check) => !check.passed)) process.exitCode = 1;
