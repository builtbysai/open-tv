// Filled in by the build (see vite.config.ts); plain values when run without it.
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_ID__: string | undefined;
declare const __BUILD_DATE__: string | undefined;
export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const BUILD_ID =
  typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "local";
export const BUILD_DATE =
  typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";
export const buildLabel = () =>
  [
    `v${APP_VERSION}`,
    BUILD_ID === "local" ? "" : `build ${BUILD_ID}`,
    BUILD_DATE,
  ]
    .filter(Boolean)
    .join(" · ");
