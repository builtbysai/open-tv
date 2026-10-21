import { STORAGE_KEY, type StorageLike } from "./user-state";
export interface Profile {
  id: string;
  name: string;
  hue: number;
  kids?: boolean;
}
export interface Registry {
  version: 1;
  active: string;
  profiles: Profile[];
}
export const REGISTRY_KEY = "opentv:profiles:v1";
export const CHOSEN_KEY = "opentv:profile-chosen:v1";
export const MAX_PROFILES = 6;
type Store = StorageLike & { removeItem?(key: string): void };
const MAIN: Profile = { id: "main", name: "Main", hue: 215 };
const hues = [215, 340, 150, 40, 270, 190];
const cleanName = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 24);
export function loadRegistry(storage: Store): Registry {
  try {
    const saved = JSON.parse(storage.getItem(REGISTRY_KEY) || "null");
    if (saved?.version === 1 && Array.isArray(saved.profiles)) {
      const profiles: Profile[] = saved.profiles
        .filter(
          (p: Profile) =>
            p &&
            typeof p.id === "string" &&
            /^[a-z0-9]{1,12}$/.test(p.id) &&
            typeof p.name === "string" &&
            cleanName(p.name),
        )
        .slice(0, MAX_PROFILES)
        .map((p: Profile) => ({
          id: p.id,
          name: cleanName(p.name),
          hue: Number.isFinite(p.hue) ? Math.abs(Math.round(p.hue)) % 360 : 215,
          ...(p.kids === true ? { kids: true } : {}),
        }));
      if (profiles.length)
        return {
          version: 1,
          profiles,
          active: profiles.some((p) => p.id === saved.active)
            ? saved.active
            : profiles[0].id,
        };
    }
  } catch {
    /* Fall through to the default profile. */
  }
  return { version: 1, active: MAIN.id, profiles: [MAIN] };
}
export function saveRegistry(storage: Store, registry: Registry) {
  try {
    storage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    /* Storage can be unavailable; profiles then last for this session. */
  }
}
// The first profile keeps the original storage key, so existing data carries over.
export const stateKey = (id: string) =>
  id === MAIN.id ? STORAGE_KEY : `${STORAGE_KEY}:${id}`;
export function profileStorage(storage: Store, id: string): StorageLike {
  return {
    getItem: (key) => storage.getItem(key === STORAGE_KEY ? stateKey(id) : key),
    setItem: (key, value) =>
      storage.setItem(key === STORAGE_KEY ? stateKey(id) : key, value),
  };
}
export function addProfile(
  registry: Registry,
  name: string,
  kids = false,
): Registry {
  const label = cleanName(name);
  if (!label || registry.profiles.length >= MAX_PROFILES) return registry;
  let id = "";
  do id = Math.random().toString(36).slice(2, 8);
  while (!id || registry.profiles.some((p) => p.id === id));
  const used = new Set(registry.profiles.map((p) => p.hue));
  const hue =
    hues.find((h) => !used.has(h)) ??
    hues[registry.profiles.length % hues.length];
  return {
    ...registry,
    profiles: [
      ...registry.profiles,
      { id, name: label, hue, ...(kids ? { kids: true } : {}) },
    ],
  };
}
export function renameProfile(
  registry: Registry,
  id: string,
  name: string,
): Registry {
  const label = cleanName(name);
  if (!label) return registry;
  return {
    ...registry,
    profiles: registry.profiles.map((p) =>
      p.id === id ? { ...p, name: label } : p,
    ),
  };
}
export function removeProfile(
  storage: Store,
  registry: Registry,
  id: string,
): Registry {
  if (registry.profiles.length < 2) return registry;
  const profiles = registry.profiles.filter((p) => p.id !== id);
  try {
    storage.removeItem?.(stateKey(id));
  } catch {
    /* The orphaned data is never read again. */
  }
  return {
    ...registry,
    profiles,
    active: registry.active === id ? profiles[0].id : registry.active,
  };
}
export const activeProfile = (registry: Registry) =>
  registry.profiles.find((p) => p.id === registry.active) ||
  registry.profiles[0];
