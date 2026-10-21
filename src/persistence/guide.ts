import { persistableUrl } from "../domain/urls";

// A guide address without a login, token or query is not a secret, so it can reconnect when
// the app opens. One with any of those stays in memory for the session only.
const KEY = "opentv:guide-url:v1";
export function readGuideUrl(): string {
  try {
    const value = localStorage.getItem(KEY) ?? "";
    return value && persistableUrl(value) ? value : "";
  } catch {
    return "";
  }
}
// Returns whether the address was kept.
export function writeGuideUrl(url: string): boolean {
  try {
    if (url && persistableUrl(url)) {
      localStorage.setItem(KEY, url);
      return true;
    }
    localStorage.removeItem(KEY);
  } catch {
    /* The guide is reconnected by hand next time. */
  }
  return false;
}
