import { defineConfig, loadEnv } from "vite";
import preact from "@preact/preset-vite";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import site from "./site.config.json";

// Old TV engines (Tizen 5.5 and webOS 5 ship Chromium 68-69) set the floor: syntax is
// lowered to ES2018, and `npm run check:compat` verifies the output and bans newer APIs.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  };
  const commit = (() => {
    try {
      return execSync("git rev-parse --short=7 HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return "local";
    }
  })();
  // public/_headers is the one source of truth for the security policy. Static hosts and the
  // Android host apply it as headers; this embeds it as a meta tag for hosts that cannot
  // (meta policies ignore frame-ancestors, so that directive is left out).
  const policy = /Content-Security-Policy:\s*(.+)/
    .exec(readFileSync("public/_headers", "utf8"))?.[1]
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith("frame-ancestors"))
    .join("; ");
  const manifest = JSON.stringify({
    name: site.name,
    short_name: site.name,
    start_url: "./",
    display: "standalone",
    background_color: "#0b0d12",
    theme_color: "#0b0d12",
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
  return {
    // Relative, so the same build runs at a site root, under a sub-path and inside the
    // Android host. Routing is hash-based, so nothing depends on the path.
    base: "./",
    build: {
      target: "es2018",
      cssTarget: "chrome61",
      chunkSizeWarningLimit: 400,
    },
    define: {
      // Chosen at build time on purpose: a runtime override would let a crafted link send
      // the TMDB key or pairing credentials to another host.
      __RELAY_URL__: JSON.stringify(
        env.VITE_RELAY_URL ||
          (site as { controlRelay?: string }).controlRelay ||
          "",
      ),
      __TMDB_BASE__: JSON.stringify(
        env.VITE_TMDB_BASE || "https://api.themoviedb.org/3",
      ),
      __TMDB_IMAGE_BASE__: JSON.stringify(
        env.VITE_TMDB_IMAGE_BASE || "https://image.tmdb.org/t/p",
      ),
      __SITE_URL__: JSON.stringify(env.VITE_SITE_URL || site.url),
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_ID__: JSON.stringify(commit),
    },
    plugins: [
      preact(),
      {
        name: "csp-meta",
        apply: "build",
        transformIndexHtml: () =>
          policy
            ? [
                {
                  tag: "meta",
                  attrs: { "http-equiv": "Content-Security-Policy", content: policy },
                  injectTo: "head-prepend",
                },
              ]
            : [],
      },
      {
        name: "manifest",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: manifest,
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
    ],
  };
});
