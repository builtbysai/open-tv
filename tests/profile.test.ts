import { describe, expect, it } from "vitest";
import { loadUserState } from "../src/persistence/user-state";
import {
  exportProfile,
  parseProfile,
  mergeProfile,
} from "../src/persistence/profile";
const empty = () => loadUserState({ getItem: () => null, setItem: () => {} });
describe("general profile transfer", () => {
  it("round-trips favorites, collections and progress without PINs or account/launch state", () => {
    const user = empty();
    user.favorites = ["ot-film"];
    user.collections = [
      { id: "ot-collection", name: "Weekend", itemIds: ["ot-film"] },
    ];
    user.progress = { "ot-film": 24 };
    user.preferences = {
      volume: 0.3,
      muted: false,
      pinHash: "private-device-hash",
      pinSalt: "private-device-salt",
    };
    const serialized = JSON.stringify(exportProfile(user));
    expect(serialized).not.toContain("private-device");
    const imported = parseProfile(serialized);
    expect(imported.favorites).toEqual(user.favorites);
    expect(imported.collections).toEqual(user.collections);
    expect(imported.progress).toEqual(user.progress);
    expect(imported.preferences.pinHash).toBeUndefined();
  });
  it("merges without erasing local favorites, collection names, progress or PIN", () => {
    const current = empty(),
      incoming = empty();
    current.favorites = ["ot-local"];
    current.collections = [
      { id: "ot-list", name: "Local name", itemIds: ["ot-local"] },
    ];
    current.progress = { "ot-local": 99 };
    current.preferences.pinHash = "local-pin";
    current.preferences.pinSalt = "local-salt";
    current.session.route = "settings";
    incoming.favorites = ["ot-remote"];
    incoming.collections = [
      { id: "ot-list", name: "Other name", itemIds: ["ot-remote"] },
    ];
    incoming.progress = { "ot-local": 1, "ot-remote": 10 };
    incoming.history = [{ id: "ot-remote", at: Date.now() }];
    incoming.session.route = "live";
    const merged = mergeProfile(current, incoming);
    expect(merged.favorites).toEqual(["ot-local", "ot-remote"]);
    expect(merged.collections[0]).toEqual({
      id: "ot-list",
      name: "Local name",
      itemIds: ["ot-local", "ot-remote"],
    });
    expect(merged.progress).toEqual({ "ot-local": 99, "ot-remote": 10 });
    expect(merged.preferences.pinHash).toBe("local-pin");
    expect(merged.session.route).toBe("settings");
    expect(current.favorites).toEqual(["ot-local"]);
  });
  it("rejects wrong/oversized backups and sanitizes injected identities, URLs and PINs", () => {
    expect(() => parseProfile("{}")).toThrow();
    expect(() => parseProfile(" ".repeat(2_000_001))).toThrow();
    const data = exportProfile(empty());
    data.profile.favorites = [
      "ot-valid",
      "https://provider/live/user/password/1",
    ];
    const json = JSON.parse(JSON.stringify(data));
    json.profile.preferences.pinHash = "injected";
    json.profile.session.nowId = "https://credential-bearing.example/";
    json.profile.session.drafts.media = {
      url: "https://user:password@provider/",
    };
    const imported = parseProfile(JSON.stringify(json));
    expect(imported.favorites).toEqual(["ot-valid"]);
    expect(imported.preferences.pinHash).toBeUndefined();
    expect(JSON.stringify(imported)).not.toMatch(
      /credential-bearing|user:password/,
    );
  });
});
