import type { Content } from "../domain/content";
import { canPersistContent } from "../domain/library";
import { diagnose } from "../domain/errors";
export interface Entry {
  id: string;
  at: number;
  items: Content[];
  sha256?: string;
  revision?: number;
  // Bumped when the shape of listings changes, so older saved copies are fetched again.
  schema?: number;
}
export const CACHE_SCHEMA = 2;
const memory = new Map<string, Entry>();
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("opentv-catalog", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("sources", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function getCached(id: string): Promise<Entry | undefined> {
  if (memory.has(id)) return memory.get(id);
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("sources");
      const request = tx.objectStore("sources").get(id);
      request.onsuccess = () => {
        db.close();
        const entry = request.result as Entry | undefined;
        resolve(entry?.schema === CACHE_SCHEMA ? entry : undefined);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    diagnose("catalog.cache-unavailable");
    return undefined;
  }
}
export async function putCached(
  id: string,
  items: Content[],
  release?: { sha256: string; revision?: number },
): Promise<void> {
  // Adult, uncertain, and credential-bearing provider catalogs are never stored on disk.
  const entry: Entry = {
    id,
    at: Date.now(),
    items: items.filter(canPersistContent),
    schema: CACHE_SCHEMA,
    ...release,
  };
  memory.set(id, entry);
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sources", "readwrite");
      tx.objectStore("sources").put(entry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    diagnose("catalog.cache-write-failed");
  }
}
export async function clearCatalogCache() {
  memory.clear();
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sources", "readwrite");
    tx.objectStore("sources").clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
