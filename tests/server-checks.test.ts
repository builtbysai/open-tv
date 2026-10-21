import { describe, expect, it } from "vitest";
import { ago, readChecks, writeChecks } from "../src/persistence/servers";
describe("server check results", () => {
  it("round-trips through storage and ignores bad entries", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    writeChecks(storage, { a: { ok: true, at: 5 } });
    expect(readChecks(storage)).toEqual({ a: { ok: true, at: 5 } });
    store.set(
      "opentv:server-checks:v1",
      '{"a":{"ok":"yes"},"b":{"ok":false,"at":9}}',
    );
    expect(readChecks(storage)).toEqual({ b: { ok: false, at: 9 } });
    store.set("opentv:server-checks:v1", "not json");
    expect(readChecks(storage)).toEqual({});
  });
  it("words elapsed time", () => {
    const now = 10_000_000;
    expect(ago(now - 20_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(ago(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });
});
