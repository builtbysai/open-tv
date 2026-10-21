import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stableId } from "../src/domain/content";
const directory = "artifacts/sync-cache";
interface CachedResponse {
  etag?: string;
  modified?: string;
  text: string;
  at: number;
}
export async function fetchJson<T>(url: string): Promise<T> {
  await mkdir(directory, { recursive: true });
  const path = `${directory}/${stableId(url)}.json`;
  let cached: CachedResponse | undefined;
  try {
    cached = JSON.parse(await readFile(path, "utf8"));
  } catch {
    /* Initial sync. */
  }
  if (cached && Date.now() - cached.at < 3600000)
    return JSON.parse(cached.text) as T;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: {
          ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          ...(cached?.modified ? { "If-Modified-Since": cached.modified } : {}),
        },
      });
      if (response.status === 304 && cached)
        return JSON.parse(cached.text) as T;
      if (!response.ok)
        throw new Error(`Catalog request failed (${response.status}).`);
      const text = await response.text();
      const value = JSON.parse(text) as T;
      await writeFile(
        path,
        JSON.stringify({
          etag: response.headers.get("etag"),
          modified: response.headers.get("last-modified"),
          text,
          at: Date.now(),
        }),
      );
      return value;
    } catch (error) {
      if (attempt === 2) {
        if (cached) {
          console.warn(
            "Using a previously fetched dataset after a network failure.",
          );
          return JSON.parse(cached.text) as T;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error("Catalog fetch failed.");
}
export function publicDestination(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !/^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
