import site from "../../site.config.json";
// The one place that names the site. Change site.config.json (or set VITE_SITE_URL at
// build time) and everything else follows: the build base path, update endpoint,
// phone setup link, deployment checks and the web app manifest.
export const SITE_NAME: string = site.name;
const configured =
  (import.meta.env?.VITE_SITE_URL as string | undefined) || site.url;
export const SITE_URL = configured.endsWith("/")
  ? configured
  : `${configured}/`;
export const SITE_ORIGIN = new URL(SITE_URL).origin;
// The path this build is served from. "/" for development, tests and the TV app bundle.
export const BASE_URL: string = import.meta.env?.BASE_URL ?? "/";
const strip = (path: string) => path.replace(/^\/+/, "");
// A bundled file such as /catalog/open-cinema.json, resolved against where the app is served.
export const appAsset = (path: string) => `${BASE_URL}${strip(path)}`;
// A file on the public site, whichever origin the app itself runs from.
export const siteUrl = (path = "") => new URL(strip(path), SITE_URL).href;
// The installed TV app serves itself from a private origin a phone cannot open.
export function publicSiteUrl(): string {
  return location.hostname === "appassets.androidplatform.net"
    ? SITE_URL
    : new URL(BASE_URL, location.origin).href;
}
