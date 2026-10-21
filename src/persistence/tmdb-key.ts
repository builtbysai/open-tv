const slot = "opentv:tmdb-key:v1";
// A template's "YOUR_TMDB_API_KEY" has the shape of a key, so it is named and refused. A v4
// read access token (a JWT, "eyJ…") is random text and is never taken for one.
const PLACEHOLDER = /your|placeholder|example|replace|insert|api_?key|tmdb/i;
export function validTmdbKey(value: unknown): string | undefined {
  const key = typeof value === "string" ? value.trim().slice(0, 600) : "";
  if (!/^[A-Za-z0-9._-]{16,600}$/.test(key) || /^(.)\1+$/.test(key))
    return undefined;
  return key.startsWith("eyJ") || !PLACEHOLDER.test(key) ? key : undefined;
}
export function loadTmdbKey(): string {
  try {
    return localStorage.getItem(slot) || "";
  } catch {
    return "";
  }
}
export function saveTmdbKey(key: string, remember: boolean) {
  try {
    if (key && remember) localStorage.setItem(slot, key);
    else localStorage.removeItem(slot);
  } catch {
    // Storage can be unavailable; the key still works for this session.
  }
}
