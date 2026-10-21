import { describe, expect, it } from "vitest";
import {
  addProfile,
  loadRegistry,
  profileStorage,
  removeProfile,
  renameProfile,
  stateKey,
  REGISTRY_KEY,
} from "../src/persistence/accounts";
import {
  STORAGE_KEY,
  loadUserState,
  saveUserState,
} from "../src/persistence/user-state";
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
describe("local profiles", () => {
  it("starts with one profile that keeps the original storage key", () => {
    const registry = loadRegistry(memory());
    expect(registry.profiles).toHaveLength(1);
    expect(stateKey(registry.active)).toBe(STORAGE_KEY);
  });
  it("adds, renames and limits profiles", () => {
    let registry = loadRegistry(memory());
    registry = addProfile(registry, "  Sam   Lee ");
    expect(registry.profiles[1].name).toBe("Sam Lee");
    expect(new Set(registry.profiles.map((p) => p.hue)).size).toBe(2);
    registry = renameProfile(registry, registry.profiles[1].id, "Kids");
    expect(registry.profiles[1].name).toBe("Kids");
    expect(addProfile(registry, "   ")).toBe(registry);
    for (let i = 0; i < 10; i++) registry = addProfile(registry, `P${i}`);
    expect(registry.profiles).toHaveLength(6);
  });
  it("keeps each profile's viewing state separate", () => {
    const store = memory();
    let registry = addProfile(loadRegistry(store), "Kids");
    const kids = registry.profiles[1];
    const main = loadUserState(profileStorage(store, "main"));
    main.favorites = ["ot-main"];
    saveUserState(profileStorage(store, "main"), main);
    const other = loadUserState(profileStorage(store, kids.id));
    expect(other.favorites).toEqual([]);
    other.favorites = ["ot-kids"];
    saveUserState(profileStorage(store, kids.id), other);
    expect(loadUserState(profileStorage(store, "main")).favorites).toEqual([
      "ot-main",
    ]);
    expect(loadUserState(profileStorage(store, kids.id)).favorites).toEqual([
      "ot-kids",
    ]);
    registry = removeProfile(store, { ...registry, active: kids.id }, kids.id);
    expect(registry.active).toBe("main");
    expect(store.data.has(stateKey(kids.id))).toBe(false);
  });
  it("never removes the last profile and ignores corrupt registries", () => {
    const store = memory();
    const registry = loadRegistry(store);
    expect(removeProfile(store, registry, "main")).toBe(registry);
    store.setItem(REGISTRY_KEY, "{not json");
    expect(loadRegistry(store).profiles).toHaveLength(1);
    store.setItem(
      REGISTRY_KEY,
      JSON.stringify({
        version: 1,
        active: "x",
        profiles: [
          { id: "../evil", name: "x" },
          { id: "ok1", name: "Ann", hue: 10 },
        ],
      }),
    );
    const loaded = loadRegistry(store);
    expect(loaded.profiles.map((p) => p.id)).toEqual(["ok1"]);
    expect(loaded.active).toBe("ok1");
  });
});
