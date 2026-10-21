import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetAccount,
  loadSavedAccounts,
  saveAccount,
} from "../src/persistence/saved-accounts";
const account = (n: number) => ({
  server: `https://p${n}.example`,
  username: "u",
  password: "p",
  mode: "movie" as const,
});
describe("saved accounts", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  it("remembers, replaces and forgets accounts", () => {
    saveAccount(account(1));
    saveAccount({ ...account(1), password: "new" });
    expect(loadSavedAccounts()).toEqual([{ ...account(1), password: "new" }]);
    forgetAccount(account(1));
    expect(loadSavedAccounts()).toEqual([]);
  });
  it("keeps the four most recent", () => {
    for (let n = 1; n <= 6; n++) saveAccount(account(n));
    expect(loadSavedAccounts().map((a) => a.server)).toEqual(
      [6, 5, 4, 3].map((n) => `https://p${n}.example`),
    );
  });
  it("ignores malformed storage", () => {
    localStorage.setItem("opentv:xtream-accounts:v1", '[{"server":1}]');
    expect(loadSavedAccounts()).toEqual([]);
  });
});
