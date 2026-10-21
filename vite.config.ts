import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { updateAssets } from "./scripts/update-assets";
import site from "./site.config.json";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const siteUrl = env.VITE_SITE_URL || site.url;
  // Only the published site build lives under a sub-path; development, tests and the
  // TV app bundle are served from "/".
  const base = env.VITE_SITE_BUILD === "1" ? new URL(siteUrl).pathname : "/";
  const manifest = JSON.stringify({
    name: site.name,
    short_name: site.name,
    start_url: "./",
    display: "standalone",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });
  // Static hosts such as GitHub Pages cannot send response headers, so the policy in
  // public/_headers is also embedded as a meta tag. Meta policies ignore
  // frame-ancestors, so that directive is left to hosts that can send headers.
  const policy = /Content-Security-Policy:\s*(.+)/
    .exec(readFileSync("public/_headers", "utf8"))?.[1]
    .split(";")
    .map((directive) => directive.trim())
    .filter(
      (directive) => directive && !directive.startsWith("frame-ancestors"),
    )
    .join("; ");
  // A general-only build leaves the 18+ playlists out of the published files.
  const generalOnly = env.VITE_PRIVATE_VIEWING === "disabled";
  // What a tester can quote when reporting a problem: the package version, the commit
  // that was built (from the host's build environment, else git) and the build date.
  const commit = (
    env.CF_PAGES_COMMIT_SHA ||
    env.GITHUB_SHA ||
    (() => {
      try {
        return execSync("git rev-parse HEAD", {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
      } catch {
        return "";
      }
    })()
  ).slice(0, 7);
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  };
  let isBuild = false;
  let output = "dist";
  return {
    base,
    build: {
      rollupOptions: {
        output: {
          // React changes far less often than the app: its own file stays cached across
          // deploys.
          manualChunks: (id: string) =>
            /node_modules\/(react|react-dom|scheduler)\//.test(id)
              ? "react"
              : undefined,
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __CONTROL_RELAY__: JSON.stringify(
        env.VITE_CONTROL_RELAY ||
          (site as { controlRelay?: string }).controlRelay ||
          "",
      ),
      __TAKEDOWN_EMAIL__: JSON.stringify(
        env.VITE_TAKEDOWN_EMAIL ||
          (site as { takedownEmail?: string }).takedownEmail ||
          "",
      ),
      __BUILD_ID__: JSON.stringify(commit || "local"),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    plugins: [
      react(),
      {
        name: "csp-meta",
        apply: "build",
        transformIndexHtml: () =>
          policy
            ? [
                {
                  tag: "meta",
                  attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content: policy,
                  },
                  injectTo: "head-prepend",
                },
              ]
            : [],
      },
      {
        name: "site-identity",
        transformIndexHtml: (html: string) =>
          html.replaceAll("%SITE_NAME%", site.name),
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: manifest,
          });
          // A cache name per build: every deploy replaces the previous shell.
          this.emitFile({
            type: "asset",
            fileName: "sw.js",
            source: readFileSync("scripts/service-worker.js", "utf8").replace(
              "__CACHE__",
              `open-tv-${pkg.version}-${commit || "local"}-${Date.now().toString(36)}`,
            ),
          });
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!request.url?.startsWith("/manifest.json")) return next();
            response.setHeader("Content-Type", "application/manifest+json");
            response.end(manifest);
          });
        },
      },
      {
        name: "public-catalog-releases",
        async generateBundle() {
          const { manifest, files } = await updateAssets(process.cwd());
          this.emitFile({
            type: "asset",
            fileName: "catalog/update-manifest.json",
            source: JSON.stringify(manifest),
          });
          for (const file of files)
            this.emitFile({
              type: "asset",
              fileName: file.path.slice(1),
              source: file.bytes,
            });
        },
        async configureServer(server) {
          const { manifest, files } = await updateAssets(server.config.root);
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || "/", "http://localhost")
              .pathname;
            const file = files.find((file) => file.path === pathname);
            if (pathname !== "/catalog/update-manifest.json" && !file)
              return next();
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Access-Control-Allow-Origin", "*");
            response.setHeader("Cache-Control", "no-store");
            response.end(file ? file.bytes : JSON.stringify(manifest));
          });
        },
      },
      {
        name: "protect-source-files",
        configResolved(config) {
          isBuild = config.command === "build";
          output = path.resolve(config.root, config.build.outDir);
          if (
            output === path.resolve(config.root) ||
            output === path.resolve(config.publicDir)
          )
            throw new Error(
              "Build output must not overwrite repository or public source files.",
            );
        },
        async closeBundle() {
          if (isBuild && generalOnly)
            for (const name of [
              "playlists/adult-vod.m3u",
              "playlists/adult-classics.m3u",
            ])
              await rm(path.join(output, name), { force: true });
        },
      },
    ],
  };
});
