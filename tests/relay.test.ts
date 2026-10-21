import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import {
  createRelay,
  createDnsResolver,
  publicAddress,
  rewriteHls,
  seal,
  unseal,
  validateConfig,
  type RelayConfig,
} from "../server/relay";
const secret = "test-only-secret-that-is-not-a-production-key";
const closers: (() => Promise<void>)[] = [];
async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
const config = (url: string, privateHosts: string[] = []): RelayConfig => ({
  origins: ["https://viewer.example"],
  sources: [
    {
      id: "fixture",
      url,
      allowedOrigins: [new URL(url).origin],
      allowPrivateHosts: privateHosts,
    },
  ],
});
async function session(base: string, url: string) {
  const response = await fetch(`${base}/v1/session`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { playbackUrl: string }).playbackUrl;
}
describe("optional authorized streaming relay", () => {
  it("coalesces DNS work for HLS fragments, expires it, and cancels viewers without opening a socket", async () => {
    let now = 0;
    const lookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 }]),
      resolver = createDnsResolver(lookup, () => now),
      signal = new AbortController().signal;
    await Promise.all([
      resolver("media.example", signal),
      resolver("media.example", signal),
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 31000;
    await resolver("media.example", signal);
    expect(lookup).toHaveBeenCalledTimes(2);
    let finish!: (addresses: { address: string; family: number }[]) => void;
    const pending = createDnsResolver(
        () =>
          new Promise((accept) => {
            finish = accept;
          }),
      ),
      abort = new AbortController(),
      request = pending("slow.example", abort.signal);
    abort.abort();
    await expect(request).rejects.toMatchObject({ status: 499 });
    finish([{ address: "1.1.1.1", family: 4 }]);
  });
  it("rejects private, metadata, transition and documentation networks", () => {
    for (const ip of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.1.1",
      "100.100.100.100",
      "169.254.169.254",
      "172.16.2.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.18.1.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2002:7f00:1::",
    ])
      expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress("1.1.1.1")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("requires explicit origins and a strong private secret", () => {
    expect(() =>
      createRelay(config("https://media.example/a.m3u8"), "short"),
    ).toThrow();
    expect(() =>
      validateConfig({
        ...config("https://media.example/a.m3u8"),
        publicBase: "http://public.example",
      }),
    ).toThrow();
    expect(() => validateConfig({ origins: ["*"], sources: [] })).toThrow();
    expect(() =>
      validateConfig(config("https://user:password@media.example/a.m3u8")),
    ).toThrow();
  });
  it("encrypts upstream credentials and rejects tampering, wrong keys and expiry", () => {
    const ticket = {
        source: "fixture",
        url: "https://media.example/live/user/password/1.m3u8",
        expires: Date.now() + 60000,
      },
      token = seal(ticket, secret);
    expect(token).not.toContain("password");
    expect(unseal(token, secret)).toEqual(ticket);
    expect(() =>
      unseal(
        `${token.slice(0, 10)}${token[10] === "a" ? "b" : "a"}${token.slice(11)}`,
        secret,
      ),
    ).toThrow();
    expect(() => unseal(token, "different-key")).toThrow();
    expect(() => unseal(token, secret, ticket.expires + 1)).toThrow();
  });
  it("rewrites variants, media, map, key and segment URLs and fails closed on unapproved origins", () => {
    const source = {
        ...config("https://media.example/root/master.m3u8").sources[0],
        allowedPathPrefixes: ["/"],
      },
      base = new URL(source.url);
    const text =
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n../video.m3u8\nseg.ts';
    const rewritten = rewriteHls(
      text,
      base,
      source,
      (url) => `https://relay.example/${encodeURIComponent(url)}`,
    );
    expect(rewritten).toContain(
      encodeURIComponent("https://media.example/root/key.bin"),
    );
    expect(rewritten).toContain(
      encodeURIComponent("https://media.example/video.m3u8"),
    );
    expect(() =>
      rewriteHls("#EXTM3U\nhttp://169.254.169.254/key", base, source, String),
    ).toThrow();
    expect(() =>
      rewriteHls(
        '#EXTM3U\n#EXT-X-KEY:URI="file:///etc/passwd"',
        base,
        source,
        String,
      ),
    ).toThrow();
    expect(() =>
      rewriteHls("<html>200 OK</html>", base, source, String),
    ).toThrow();
    expect(() =>
      rewriteHls("#EXTM3U\n{$unresolved}.m3u8", base, source, String),
    ).toThrow();
    const scoped = { ...source, allowedPathPrefixes: ["/root/"] };
    expect(() =>
      rewriteHls("#EXTM3U\n../admin/secret", base, scoped, String),
    ).toThrow();
    expect(() =>
      rewriteHls("#EXTM3U\n/root/%252e%252e/admin", base, scoped, String),
    ).toThrow();
    expect(() =>
      rewriteHls("#EXTM3U\n/root/%2f..%2fadmin", base, scoped, String),
    ).toThrow();
  });
  it("blocks unauthenticated sessions, foreign origins and arbitrary URL requests", async () => {
    const base = await listen(
      createRelay(config("https://media.example/a.m3u8"), secret),
    );
    expect(
      (await fetch(`${base}/v1/session`, { method: "POST", body: "{}" }))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/health`, {
          headers: { origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/v1/session`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: JSON.stringify({ url: "http://169.254.169.254/" }),
        })
      ).status,
    ).toBe(403);
  });
  it("blocks private destinations by default even with a valid ticket", async () => {
    let hits = 0;
    const upstream = await listen(
      http.createServer((_req, res) => {
        hits++;
        res.end("no");
      }),
    );
    const url = `${upstream}/movie.mp4`,
      base = await listen(createRelay(config(url), secret)),
      play = await session(base, url);
    expect((await fetch(play)).status).toBe(403);
    expect(hits).toBe(0);
  });
  it("preserves byte ranges and CORS without leaking cookies or upstream headers", async () => {
    const upstream = await listen(
      http.createServer((req, res) => {
        expect(req.headers.range).toBe("bytes=2-4");
        expect(req.headers.cookie).toBeUndefined();
        res.writeHead(206, {
          "content-type": "video/mp4",
          "content-range": "bytes 2-4/6",
          "accept-ranges": "bytes",
          "set-cookie": "private=secret",
          "content-length": "3",
        });
        res.end("cde");
      }),
    );
    const url = `${upstream}/movie.mp4`,
      base = await listen(createRelay(config(url, ["127.0.0.1"]), secret)),
      play = await session(base, url);
    const response = await fetch(play, {
      headers: {
        range: "bytes=2-4",
        origin: "https://viewer.example",
        cookie: "must-not-forward=1",
      },
    });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("cde");
    expect(response.headers.get("content-range")).toBe("bytes 2-4/6");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://viewer.example",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      (await fetch(play, { headers: { range: "bytes=0-2,4-6" } })).status,
    ).toBe(416);
  });
  it("follows only allowed redirects and resolves rewritten HLS paths against the final URL", async () => {
    const upstream = await listen(
      http.createServer((req, res) => {
        if (req.url === "/entry.m3u8") {
          res.writeHead(302, { location: "/nested/master.m3u8" });
          res.end();
        } else if (req.url === "/nested/master.m3u8") {
          res.writeHead(200, {
            "content-type": "application/vnd.apple.mpegurl",
          });
          res.end("#EXTM3U\nvideo.m3u8");
        } else if (req.url === "/nested/video.m3u8") {
          res.writeHead(200, {
            "content-type": "application/vnd.apple.mpegurl",
          });
          res.end("#EXTM3U\n#EXT-X-ENDLIST");
        } else if (req.url === "/unsafe.m3u8") {
          res.writeHead(302, { location: "http://169.254.169.254/latest" });
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      }),
    );
    const cfg = config(`${upstream}/entry.m3u8`, ["127.0.0.1"]);
    cfg.sources.push({
      ...cfg.sources[0],
      id: "unsafe",
      url: `${upstream}/unsafe.m3u8`,
    });
    const base = await listen(createRelay(cfg, secret)),
      play = await session(base, cfg.sources[0].url),
      response = await fetch(play),
      text = await response.text(),
      child = text.split("\n")[1];
    expect(response.status).toBe(200);
    expect(child).toContain(`${base}/v1/resource/`);
    expect(await (await fetch(child)).text()).toContain("#EXT-X-ENDLIST");
    expect((await fetch(play, { method: "HEAD" })).status).toBe(200);
    expect((await fetch(await session(base, cfg.sources[1].url))).status).toBe(
      403,
    );
  });
  it("limits concurrent upstream work and releases a slot when the viewer disconnects", async () => {
    const upstream = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "video/mp4" });
        res.write("sample");
      }),
    );
    const cfg = {
        ...config(`${upstream}/slow.mp4`, ["127.0.0.1"]),
        maxConcurrent: 1,
      },
      base = await listen(createRelay(cfg, secret)),
      play = await session(base, cfg.sources[0].url),
      abort = new AbortController();
    const first = await fetch(play, { signal: abort.signal });
    expect(first.status).toBe(200);
    expect((await fetch(play)).status).toBe(429);
    abort.abort();
    await first.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    const nextAbort = new AbortController(),
      next = await fetch(play, { signal: nextAbort.signal });
    expect(next.status).toBe(200);
    nextAbort.abort();
  });
});
