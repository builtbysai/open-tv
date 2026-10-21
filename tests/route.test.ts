import { describe, expect, it, vi } from "vitest";
import {
  createTransport,
  ROUTE_TTL,
  TransportBlocked,
  type TransportOptions,
} from "../src/playback/route";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      return handler(url, init);
    },
  ) as unknown as typeof fetch;
  return { fetcher, calls };
}
const media = () =>
  new Response("binary", {
    status: 206,
    headers: { "content-type": "video/mp2t" },
  });
const playlist = (body: string) =>
  new Response(body, {
    headers: { "content-type": "application/vnd.apple.mpegurl" },
  });
const signal = () => new AbortController().signal;
function transport(
  extra: Partial<TransportOptions> & { handler?: Handler } = {},
) {
  const { handler = () => new Response("", { status: 404 }), ...rest } = extra;
  const { fetcher, calls } = fakeFetch(handler);
  const storage = new MemoryStorage();
  let clock = 1_000_000;
  const resolve = createTransport({
    relay: null,
    protocol: "https:",
    origin: "https://app.example",
    inApp: false,
    storage,
    fetcher,
    now: () => clock,
    ...rest,
  });
  return {
    resolve,
    calls,
    storage,
    advance: (ms: number) => (clock += ms),
  };
}

describe("transport resolver", () => {
  it("plays HTTPS directly and doesn't remember it", async () => {
    const t = transport();
    const result = await t.resolve(
      "https://cdn.example/a.mp4",
      signal(),
      "video",
    );
    expect(result).toMatchObject({
      route: "direct",
      url: "https://cdn.example/a.mp4",
    });
    expect(t.calls).toEqual([]);
    expect(t.storage.data.size).toBe(0);
  });
  it("on a plain-HTTP page, everything is direct", async () => {
    const t = transport({ protocol: "http:" });
    expect(
      (await t.resolve("http://10.0.0.5/live.m3u8", signal(), "hls")).route,
    ).toBe("direct");
  });
  it("uses a probed HTTPS twin, remembers it per host, and reuses it after reload", async () => {
    const t = transport({
      handler: (url) =>
        url.startsWith("https://tv.example/")
          ? playlist("#EXTM3U\n")
          : new Response("", { status: 404 }),
    });
    const first = await t.resolve(
      "http://tv.example/live/index.m3u8",
      signal(),
      "hls",
    );
    expect(first).toMatchObject({
      route: "https",
      url: "https://tv.example/live/index.m3u8",
      cached: false,
    });
    expect(t.calls).toEqual(["https://tv.example/live/index.m3u8"]);
    // A new resolver over the same storage (a reload) goes straight there.
    const again = createTransport({
      relay: null,
      protocol: "https:",
      inApp: false,
      storage: t.storage,
      fetcher: fakeFetch(() => playlist("#EXTM3U\n")).fetcher,
      now: () => 1_000_000 + 60_000,
    });
    const second = await again(
      "http://tv.example/other/index.m3u8",
      signal(),
      "hls",
    );
    expect(second).toMatchObject({ route: "https", cached: true });
  });
  it("a video file's HTTPS twin counts when it answers with a media type", async () => {
    const t = transport({ handler: () => media() });
    expect(
      await t.resolve("http://files.example:80/film.mp4", signal(), "video"),
    ).toMatchObject({ route: "https", url: "https://files.example/film.mp4" });
  });
  it("forgets a remembered route after a day", async () => {
    const t = transport({ handler: () => playlist("#EXTM3U\n") });
    await t.resolve("http://tv.example/a.m3u8", signal(), "hls");
    t.advance(ROUTE_TTL + 1);
    const later = await t.resolve("http://tv.example/a.m3u8", signal(), "hls");
    expect(later.cached).toBe(false);
  });
  it("an HTTPS twin that isn't media doesn't count", async () => {
    const t = transport({
      handler: () =>
        new Response("<html>login</html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    await expect(
      t.resolve("http://tv.example/live.m3u8", signal(), "hls"),
    ).rejects.toMatchObject({
      reason: "no-https",
    });
  });
  it("skips the HTTPS probe for a bare IP and fails fast without a relay", async () => {
    const t = transport();
    const error = await t
      .resolve("http://23.1.2.3:8080/live.m3u8", signal(), "hls")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportBlocked);
    expect((error as TransportBlocked).reason).toBe("no-relay");
    expect((error as TransportBlocked).message).toMatch(/bare IP address/);
    expect(t.calls).toEqual([]);
  });
  it("in the TV app, a bare IP goes through the app's own route", async () => {
    const t = transport({ inApp: true });
    const result = await t.resolve(
      "http://23.1.2.3:8080/live/index.m3u8?k=1",
      signal(),
      "hls",
    );
    expect(result).toMatchObject({
      route: "host",
      url: "https://app.example/__http/23.1.2.3:8080/live/index.m3u8?k=1",
    });
    expect(t.calls).toEqual([]);
  });
  it("won't hand an address with credentials to the TV app", async () => {
    const t = transport({ inApp: true });
    await expect(
      t.resolve("http://user:pw@23.1.2.3/live.m3u8", signal(), "hls"),
    ).rejects.toMatchObject({ reason: "host-ineligible" });
  });
  it("on the web, uses the configured relay, and reports a refusal as such", async () => {
    const relay = {
      base: "https://relay.example",
      secret: "s".repeat(40),
      mode: "http" as const,
    };
    const ok = transport({
      relay,
      handler: (url) =>
        url === "https://relay.example/v1/session"
          ? Response.json({
              playbackUrl: "https://relay.example/v1/resource/abc",
            })
          : new Response("", { status: 404 }),
    });
    expect(
      await ok.resolve("http://23.1.2.3/live.m3u8", signal(), "hls"),
    ).toMatchObject({
      route: "relay",
      url: "https://relay.example/v1/resource/abc",
    });
    // Nothing but the relay you set up was contacted.
    expect(ok.calls).toEqual(["https://relay.example/v1/session"]);
    const refused = transport({
      relay,
      handler: () => new Response("", { status: 403 }),
    });
    await expect(
      refused.resolve("http://23.1.2.3/live.m3u8", signal(), "hls"),
    ).rejects.toMatchObject({ reason: "relay-refused" });
  });
  it("treats an HTTPS playlist with HTTP segments as HTTP", async () => {
    const handler: Handler = (url) =>
      url === "https://cdn.example/master.m3u8"
        ? playlist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n")
        : url === "https://cdn.example/low/index.m3u8"
          ? playlist("#EXTM3U\n#EXTINF:6,\nhttp://seg.example/1.ts\n")
          : new Response("", { status: 404 });
    const app = transport({ inApp: true, handler });
    expect(
      await app.resolve("https://cdn.example/master.m3u8", signal(), "hls"),
    ).toMatchObject({
      route: "host",
      url: "https://app.example/__https/cdn.example/master.m3u8",
    });
    const web = transport({ handler });
    await expect(
      web.resolve("https://cdn.example/master.m3u8", signal(), "hls"),
    ).rejects.toMatchObject({ reason: "no-relay" });
    // A clean HTTPS playlist stays direct.
    const clean = transport({
      handler: () => playlist("#EXTM3U\n#EXTINF:6,\nseg1.ts\n"),
    });
    expect(
      (await clean.resolve("https://cdn.example/clean.m3u8", signal(), "hls"))
        .route,
    ).toBe("direct");
  });
  it("a failure clears the remembered route and the next play resolves again", async () => {
    let twinUp = true;
    const t = transport({
      inApp: true,
      handler: () =>
        twinUp ? playlist("#EXTM3U\n") : new Response("", { status: 503 }),
    });
    expect(
      (await t.resolve("http://tv.example/a.m3u8", signal(), "hls")).route,
    ).toBe("https");
    twinUp = false;
    t.resolve.invalidate?.("http://tv.example/a.m3u8");
    const after = await t.resolve("http://tv.example/a.m3u8", signal(), "hls");
    expect(after).toMatchObject({ route: "host", cached: false });
  });
  it("a relay set for all media is used for everything, as configured", async () => {
    const t = transport({
      relay: {
        base: "https://relay.example",
        secret: "s".repeat(40),
        mode: "all",
      },
      handler: () =>
        Response.json({ playbackUrl: "https://relay.example/v1/resource/x" }),
    });
    expect(
      (await t.resolve("https://cdn.example/a.mp4", signal(), "video")).route,
    ).toBe("relay");
  });
});
