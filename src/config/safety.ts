// Public deployment configuration, never provider credentials.
export const privateViewingEnabled =
  import.meta.env.VITE_PRIVATE_VIEWING !== "disabled";
// Set in site.config.json ("takedownEmail") or with VITE_TAKEDOWN_EMAIL at build time.
declare const __TAKEDOWN_EMAIL__: string | undefined;
const configured =
  typeof __TAKEDOWN_EMAIL__ === "string" ? __TAKEDOWN_EMAIL__ : "";
export const takedownEmail = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(
  configured,
)
  ? configured
  : "";

// A private repository issue form is not a public reporting service.
export const publicReportEndpoint = (() => {
  try {
    const url = new URL(import.meta.env.VITE_PUBLIC_REPORT_URL || "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
})();
