import type { Content } from "../domain/content";
import { canPersistContent } from "../domain/library";
import { diagnose } from "../domain/errors";
import { validateContent } from "../providers/catalog";
import { getCached } from "./catalog-cache";
const key = "personal-media";
interface LibrarySnapshot {
  version: 1;
  id: string;
  items: Content[];
}
let writes: Promise<unknown> = Promise.resolve();
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("opentv-library", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("library", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readLibrary(): Promise<Content[]> {
  try {
    const db = await database();
    const snapshot = await new Promise<LibrarySnapshot | undefined>(
      (resolve, reject) => {
        const tx = db.transaction("library");
        const request = tx.objectStore("library").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      },
    );
    if (snapshot?.version === 1)
      return validateContent(snapshot.items).filter(canPersistContent);
    // Upgrade from the first rebuild: cache clearing must never erase user-owned media.
    const old = await getCached(key);
    const items = old
      ? validateContent(old.items).filter(canPersistContent)
      : [];
    if (items.length) await writeLibrary(items);
    return items;
  } catch {
    diagnose("library.read-failed");
    return [];
  }
}
export function writeLibrary(items: Content[]): Promise<boolean> {
  const snapshot: LibrarySnapshot = {
    version: 1,
    id: key,
    items: items.filter(canPersistContent),
  };
  const write = async () => {
    try {
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("library", "readwrite");
        tx.objectStore("library").put(snapshot);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      });
      return true;
    } catch {
      diagnose("library.write-failed");
      return false;
    }
  };
  const next = writes.then(write, write);
  writes = next;
  return next;
}
