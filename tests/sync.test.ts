import { describe, expect, it } from "vitest";
import type { Source } from "../src/domain/content";
import type { MediaServer } from "../src/domain/servers";
import {
  compact,
  emptyDoc,
  merge,
  MAX_TOMBSTONES,
  prune,
  stamp,
  TOMBSTONE_AGE,
  type SyncDoc,
} from "../src/sync/doc";
import {
  applyToUser,
  cleanValue,
  snapshot,
  type SyncState,
} from "../src/sync/state";
import {
  credential,
  parseControllerMessage,
  parseCredential,
  parseTvMessage,
  PROTOCOL,
  SYNC_BYTES,
} from "../src/remote/protocol";

const builtIn = new Map([
  ["classic-films", false],
  ["free-news", false],
]);
const playlist: Source = {
  id: "ot-list1",
  name: "My channels",
  url: "https://lists.example.com/channels.m3u",
  kind: "m3u",
  classification: "general",
  enabled: true,
  description: "Your playlist",
  refreshHours: 24,
};
const film = (enabled: boolean): Source => ({
  id: "classic-films",
  name: "Classic films",
  url: "https://example.com/films.m3u",
  kind: "m3u",
  classification: "general",
  enabled,
  description: "Built in",
  refreshHours: 24,
});
const server: MediaServer = {
  id: "ot-srv1",
  name: "Home",
  base: "https://media.example.com",
  classification: "general",
  enabled: true,
};
const state = (patch: Partial<SyncState> = {}): SyncState => ({
  user: {
    favorites: [],
    wishlist: [],
    collections: [],
    history: [],
    progress: {},
  },
  sources: [film(false)],
  servers: [],
  music: [],
  lookups: true,
  ...patch,
});
const user = (patch: Partial<SyncState["user"]>): SyncState["user"] => ({
  ...state().user,
  ...patch,
});
const docOf = (s: SyncState, prev = emptyDoc(), now = 1000, first = false) =>
  stamp(prev, snapshot(s, builtIn), now, first).doc;

describe("sync document: stamping local changes", () => {
  it("stamps new and changed values, keeps unchanged ones, and tombstones removals", () => {
    const a = docOf(state({ user: user({ favorites: ["ot-a", "ot-b"] }) }));
    expect(a.e["fav:ot-a"]).toEqual([1000, 1]);
    const { doc: b, changed } = stamp(
      a,
      snapshot(
        state({
          user: user({ favorites: ["ot-a"], progress: { "ot-a": 42.7 } }),
        }),
        builtIn,
      ),
      2000,
    );
    expect(b.e["fav:ot-a"]).toEqual([1000, 1]);
    expect(b.e["fav:ot-b"]).toEqual([2000, null]);
    expect(b.e["prog:ot-a"]).toEqual([2000, 42]);
    expect(changed.sort()).toEqual(["fav:ot-b", "prog:ot-a"]);
  });
  it("on the first run counts what is here as older than any later choice: defaults at 0", () => {
    const doc = docOf(
      state({ user: user({ favorites: ["ot-a"] }), sources: [film(false)] }),
      emptyDoc(),
      5000,
      true,
    );
    expect(doc.e["src:classic-films"]).toEqual([0, { on: false }]);
    expect(doc.e["set:lookups"]).toEqual([0, true]);
    expect(doc.e["fav:ot-a"]).toEqual([1, 1]);
  });
  it("never tombstones an extension list this device hasn't loaded", () => {
    const prev: SyncDoc = { v: 1, e: { "src:ext-1": [10, { on: true }] } };
    expect(docOf(state(), prev, 2000).e["src:ext-1"]).toEqual([
      10,
      { on: true },
    ]);
  });
  it("moves a change past a peer's clock when that clock ran ahead", () => {
    const prev: SyncDoc = { v: 1, e: { "prog:ot-a": [9000, 10] } };
    const doc = docOf(
      state({ user: user({ progress: { "ot-a": 20 } }) }),
      prev,
      5000,
    );
    expect(doc.e["prog:ot-a"]).toEqual([9001, 20]);
  });
});

describe("sync document: merging (last writer wins)", () => {
  it("takes the newer value per key and reports what changed and what the other side lacks", () => {
    const local: SyncDoc = {
      v: 1,
      e: { "prog:ot-a": [100, 10], "fav:ot-b": [100, 1] },
    };
    const remote: SyncDoc = {
      v: 1,
      e: { "prog:ot-a": [200, 30], "fav:ot-c": [50, 1] },
    };
    const { doc, changed, behind } = merge(local, remote);
    expect(doc.e["prog:ot-a"]).toEqual([200, 30]);
    expect(changed.sort()).toEqual(["fav:ot-c", "prog:ot-a"]);
    expect(behind).toEqual(["fav:ot-b"]);
  });
  it("lets a newer removal win over an older value, and a newer value over a removal", () => {
    const live: SyncDoc = { v: 1, e: { "fav:ot-a": [100, 1] } };
    const gone: SyncDoc = { v: 1, e: { "fav:ot-a": [200, null] } };
    expect(merge(live, gone).doc.e["fav:ot-a"]).toEqual([200, null]);
    expect(merge(gone, live).doc.e["fav:ot-a"]).toEqual([200, null]);
    const back: SyncDoc = { v: 1, e: { "fav:ot-a": [300, 1] } };
    expect(merge(gone, back).doc.e["fav:ot-a"]).toEqual([300, 1]);
  });
  it("settles ties the same way on both devices", () => {
    const a: SyncDoc = { v: 1, e: { "src:free-news": [1, { on: true }] } };
    const b: SyncDoc = { v: 1, e: { "src:free-news": [1, { on: false }] } };
    expect(merge(a, b).doc).toEqual(merge(b, a).doc);
    const tomb: SyncDoc = { v: 1, e: { "fav:ot-a": [5, null] } };
    const live: SyncDoc = { v: 1, e: { "fav:ot-a": [5, 1] } };
    expect(merge(tomb, live).doc.e["fav:ot-a"]).toEqual([5, 1]);
    expect(merge(live, tomb).doc.e["fav:ot-a"]).toEqual([5, 1]);
  });
  it("is idempotent and adds no duplicates", () => {
    const a = docOf(state({ user: user({ favorites: ["ot-a", "ot-b"] }) }));
    const once = merge(a, a);
    expect(once.changed).toEqual([]);
    expect(once.behind).toEqual([]);
    const u = user({ favorites: ["ot-a"], history: [{ id: "ot-a", at: 5 }] });
    const applied = applyToUser(u, {
      "fav:ot-a": 1,
      "fav:ot-b": 1,
      "hist:ot-a": 9,
    });
    expect(applied.favorites).toEqual(["ot-a", "ot-b"]);
    expect(applied.history).toEqual([{ id: "ot-a", at: 9 }]);
    expect(applyToUser(applied, { "fav:ot-b": 1 }).favorites).toEqual([
      "ot-a",
      "ot-b",
    ]);
  });
  it("merges offline edits from both sides into the same result", () => {
    const base = docOf(
      state({
        user: user({ favorites: ["ot-a", "ot-b"], progress: { "ot-m": 60 } }),
      }),
    );
    // The phone, offline: removes a favorite, saves another, watches further.
    const phone = docOf(
      state({
        user: user({ favorites: ["ot-a", "ot-c"], progress: { "ot-m": 300 } }),
      }),
      base,
      3000,
    );
    // The TV, offline too: saves something else and watched less, earlier.
    const tv = docOf(
      state({
        user: user({
          favorites: ["ot-a", "ot-b", "ot-d"],
          progress: { "ot-m": 120 },
        }),
      }),
      base,
      2000,
    );
    const onTv = merge(tv, phone).doc;
    const onPhone = merge(phone, tv).doc;
    expect(onTv).toEqual(onPhone);
    const result = applyToUser(user({ favorites: ["ot-a", "ot-b", "ot-d"] }), {
      ...Object.fromEntries(
        Object.entries(onTv.e).map(([key, entry]) => [key, entry[1]]),
      ),
    });
    expect(result.favorites.sort()).toEqual(["ot-a", "ot-c", "ot-d"]);
    expect(result.progress["ot-m"]).toBe(300);
  });
  it("on a fresh TV, the phone's document simply wins", () => {
    const tv = docOf(state(), emptyDoc(), 9_000_000, true);
    const phone = docOf(
      state({
        user: user({ favorites: ["ot-a"], progress: { "ot-m": 90 } }),
        sources: [film(true), playlist],
        servers: [server],
      }),
      emptyDoc(),
      1000,
      true,
    );
    const { doc, changed } = merge(tv, phone);
    expect(doc.e["src:classic-films"][1]).toEqual({ on: true });
    expect(doc.e["src:ot-list1"][1]).toMatchObject({
      on: true,
      url: playlist.url,
    });
    expect(changed).toContain("srv:ot-srv1");
    expect(changed).toContain("prog:ot-m");
  });
  it("applies what it merged without echoing it back", () => {
    const phone = docOf(
      state({
        user: user({
          favorites: ["ot-a"],
          history: [{ id: "ot-m", at: 50 }],
          progress: { "ot-m": 90 },
          collections: [{ id: "ot-c1", name: "Weekend", itemIds: ["ot-a"] }],
        }),
      }),
    );
    const tvDoc = docOf(state(), emptyDoc(), 10, true);
    const { doc, changed } = merge(tvDoc, phone);
    const tvUser = applyToUser(
      state().user,
      Object.fromEntries(changed.map((key) => [key, doc.e[key][1]])),
    );
    const again = stamp(doc, snapshot(state({ user: tvUser }), builtIn), 99);
    expect(again.changed).toEqual([]);
  });
});

describe("sync document: tombstones and size", () => {
  it("keeps tombstones for 30 days and at most 500", () => {
    const now = TOMBSTONE_AGE * 2;
    const doc: SyncDoc = {
      v: 1,
      e: {
        "fav:ot-old": [now - TOMBSTONE_AGE - 1, null],
        "fav:ot-new": [now - 1000, null],
        "fav:ot-live": [1, 1],
      },
    };
    expect(Object.keys(prune(doc, now).e).sort()).toEqual([
      "fav:ot-live",
      "fav:ot-new",
    ]);
    const many: SyncDoc = { v: 1, e: {} };
    for (let i = 0; i < MAX_TOMBSTONES + 50; i++)
      many.e[`fav:ot-${i}`] = [now - i, null];
    const kept = prune(many, now);
    expect(Object.keys(kept.e)).toHaveLength(MAX_TOMBSTONES);
    expect(kept.e["fav:ot-0"]).toBeDefined();
  });
  it("caps history and positions, leaves hidden keys out, and fits the budget", () => {
    const doc: SyncDoc = { v: 1, e: {} };
    for (let i = 0; i < 400; i++) {
      doc.e[`hist:ot-h${i}`] = [i, i];
      doc.e[`prog:ot-p${i}`] = [i, i];
    }
    doc.e["fav:ot-adult"] = [1, 1];
    const out = compact(doc, SYNC_BYTES, (key) => key === "fav:ot-adult");
    const keys = Object.keys(out.e);
    expect(keys.filter((k) => k.startsWith("hist:"))).toHaveLength(100);
    expect(keys.filter((k) => k.startsWith("prog:"))).toHaveLength(300);
    expect(out.e["hist:ot-h399"]).toBeDefined();
    expect(out.e["fav:ot-adult"]).toBeUndefined();
    const small = compact(doc, 2000);
    expect(JSON.stringify(small.e).length).toBeLessThanOrEqual(2000);
    expect(small.e["prog:ot-p399"]).toBeDefined();
  });
});

describe("what syncs", () => {
  it("never includes 18+ sources or servers, accounts, the PIN, keys or device settings", () => {
    const full = {
      ...state().user,
      favorites: ["ot-a"],
      preferences: {
        volume: 0.3,
        muted: true,
        pinHash: "a".repeat(64),
        pinSalt: "b".repeat(32),
      },
      session: { route: "settings" },
    };
    const doc = docOf(
      state({
        user: full,
        sources: [
          playlist,
          { ...playlist, id: "ot-adult", classification: "adult" },
          {
            ...playlist,
            id: "ot-xt",
            kind: "xtream",
            url: "https://xt.example.com/get.php?username=u&password=p",
          },
          { ...playlist, id: "ot-unknown", classification: "unknown" },
        ],
        servers: [
          server,
          { ...server, id: "ot-srv2", classification: "adult" },
        ],
      }),
    );
    const text = JSON.stringify(doc);
    expect(Object.keys(doc.e).sort()).toEqual([
      "fav:ot-a",
      "set:lookups",
      "src:ot-list1",
      "srv:ot-srv1",
    ]);
    for (const secret of ["pin", "aaaa", "volume", "muted", "password", "tmdb"])
      expect(text).not.toContain(secret);
  });
  it("refuses incoming values this device can't safely use", () => {
    expect(
      cleanValue("srv:ot-srv2", {
        ...server,
        id: "ot-srv2",
        classification: "adult",
      }),
    ).toBeUndefined();
    expect(cleanValue("srv:ot-srv1", server)).toEqual(server);
    expect(
      cleanValue("src:ot-x", {
        on: true,
        name: "X",
        url: "https://u:p@example.com/a.m3u",
      }),
    ).toBeUndefined();
    expect(
      cleanValue("src:ot-x", {
        on: true,
        name: "X",
        url: "javascript:alert(1)",
      }),
    ).toBeUndefined();
    expect(cleanValue("set:tmdbKey", "abc")).toBeUndefined();
    expect(cleanValue("set:adult", true)).toBeUndefined();
    expect(cleanValue("fav:../x", 1)).toBeUndefined();
    expect(cleanValue("prog:ot-a", -4)).toBeUndefined();
    expect(
      cleanValue("wish:movie:7", { kind: "movie", tmdbId: 8, title: "T" }),
    ).toBeUndefined();
    expect(cleanValue("fav:ot-a", null)).toBeNull();
  });
});

describe("control protocol: sync messages", () => {
  const doc = { v: 1, e: { "fav:ot-a": [1, 1], "prog:ot-a": [2, 40] } };
  it("accepts a sync document both ways, with a target on the TV side", () => {
    expect(
      parseControllerMessage(JSON.stringify({ t: "sync", doc, full: true })),
    ).toEqual({ t: "sync", doc, full: true });
    expect(
      parseTvMessage(JSON.stringify({ t: "sync", doc, to: "phone-0001" })),
    ).toEqual({ t: "sync", doc, to: "phone-0001" });
    expect(parseTvMessage(JSON.stringify({ t: "sync", doc }))).toEqual({
      t: "sync",
      doc,
    });
  });
  it("refuses malformed or oversized documents", () => {
    const bad = (value: unknown) =>
      parseControllerMessage(JSON.stringify({ t: "sync", doc: value }));
    expect(bad({ v: 2, e: {} })).toBeNull();
    expect(bad({ v: 1, e: [] })).toBeNull();
    expect(bad({ v: 1, e: { "bad key": [1, 1] } })).toBeNull();
    expect(bad({ v: 1, e: { "fav:ot-a": [-1, 1] } })).toBeNull();
    expect(bad({ v: 1, e: { "fav:ot-a": [1] } })).toBeNull();
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 5000; i++) many[`fav:ot-${i}`] = [1, 1];
    expect(bad({ v: 1, e: many })).toBeNull();
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++)
      big[`coll:ot-${i}`] = [1, { n: "x".repeat(2100) }];
    expect(bad({ v: 1, e: big })).toBeNull();
    expect(
      parseTvMessage(JSON.stringify({ t: "sync", doc, to: "x" })),
    ).toBeNull();
  });
  it("lets a phone pairing again offer its old credential to be replaced", () => {
    const header = [
      PROTOCOL,
      credential.claim("code-000000001"),
      credential.controller("phone-0001", "token-00000001"),
    ].join(", ");
    expect(parseCredential(header)).toEqual({
      kind: "claim",
      code: "code-000000001",
      replace: { id: "phone-0001", token: "token-00000001" },
    });
    expect(
      parseCredential(
        [PROTOCOL, credential.controller("phone-0001", "token-00000001")].join(
          ",",
        ),
      ),
    ).toEqual({
      kind: "controller",
      id: "phone-0001",
      token: "token-00000001",
    });
  });
});
