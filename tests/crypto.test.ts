import { describe, expect, it } from "vitest";
import { importKey, newSecretKey, open, randomId, seal } from "../src/core/crypto";

describe("end-to-end encryption of setup data", () => {
  it("round-trips, and a different key or tampering opens nothing", async () => {
    const key = await importKey(newSecretKey());
    const sealed = await seal(key, JSON.stringify({ "cfg:tmdb": [1, "secret-key"] }));
    expect(sealed.ct).not.toContain("secret");
    expect(await open(key, sealed)).toContain("secret-key");
    expect(await open(await importKey(newSecretKey()), sealed)).toBeNull();
    expect(await open(key, { ...sealed, ct: sealed.ct.slice(0, -4) + "AAAA" })).toBeNull();
  });
  it("never reuses a nonce and makes url-safe ids", async () => {
    const key = await importKey(newSecretKey());
    const a = await seal(key, "x");
    const b = await seal(key, "x");
    expect(a.iv).not.toBe(b.iv);
    expect(randomId(12)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
  it("refuses a key of the wrong length", async () => {
    await expect(importKey("short")).rejects.toThrow();
  });
});
