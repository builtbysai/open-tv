import type { ExtensionFile, ExtensionSource } from "./format";
import { AppError, diagnose } from "../domain/errors";

// The imported extension is kept in this browser's own storage, as one record, and never
// sent anywhere. Playlist text and catalog entries are read from it when a source loads.
const DB = "opentv-extension";
const STORE = "files";
const KEY = "device";
let memory: ExtensionFile | null = null;
let loaded = false;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadDeviceExtension(): Promise<ExtensionFile | null> {
  if (loaded) return memory;
  try {
    const value = await transact("readonly", (s) => s.get(KEY));
    // Files saved before settings were supported lack these lists.
    const saved = value as ExtensionFile | undefined;
    memory = saved
      ? {
          ...saved,
          musicProviders: saved.musicProviders ?? [],
          servers: saved.servers ?? [],
          guides: saved.guides ?? [],
        }
      : null;
  } catch {
    diagnose("extension.read-failed");
  }
  loaded = true;
  return memory;
}
export async function saveDeviceExtension(
  file: ExtensionFile,
): Promise<boolean> {
  memory = file;
  loaded = true;
  try {
    await transact("readwrite", (s) => s.put(file, KEY));
    return true;
  } catch {
    diagnose("extension.write-failed");
    return false;
  }
}
export async function clearDeviceExtension(): Promise<void> {
  memory = null;
  loaded = true;
  try {
    await transact("readwrite", (s) => s.delete(KEY));
  } catch {
    diagnose("extension.write-failed");
  }
}

// Sources from an extension that the site itself serves are held in memory only.
const site = new Map<string, ExtensionSource>();
export function setSiteExtension(file: ExtensionFile | null) {
  site.clear();
  for (const s of file?.sources ?? []) site.set(s.id, s);
}
// The playlist text or catalog entries of one source, from whichever extension has it.
export function inlineData(id: string): ExtensionSource | undefined {
  return site.get(id) ?? memory?.sources.find((source) => source.id === id);
}

// The address an extension was loaded from, kept so it can be refreshed. It may carry a
// private token, so it stays on this device and is never shown in full.
const URL_KEY = "opentv:extension-url:v1";
export function readExtensionUrl(): string {
  try {
    return localStorage.getItem(URL_KEY) ?? "";
  } catch {
    return "";
  }
}
export function writeExtensionUrl(url: string) {
  try {
    if (url) localStorage.setItem(URL_KEY, url);
    else localStorage.removeItem(URL_KEY);
  } catch {
    diagnose("extension.write-failed");
  }
}
// An extension address must be a plain HTTPS address without a login in it.
export function checkExtensionUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError(
      "format",
      "Enter a full address that starts with https://",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new AppError(
      "format",
      "Use an https:// address without a username or password.",
    );
  return url.href;
}
