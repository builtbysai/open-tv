import { describe, expect, it, vi } from "vitest";
import {
  GuideService,
  GUIDE_REFRESH_MS,
  guideFetchUrl,
  guideStatusText,
} from "../src/guide/service";
import { xmltvTime } from "../src/providers/epg";
const programs = [
  { channelId: "news", title: "Morning news", start: 1, end: 2 },
];

describe("authorized XMLTV refresh", () => {
  it("sends no credentials/referrer and reuses the schedule until its refresh time", async () => {
    let now = 100000;
    const fetcher = vi.fn(async () => new Response("xml"));
    const parse = vi.fn(() => programs);
    const service = new GuideService(fetcher, parse, () => now);
    await service.connect(
      "https://guide.example/list.xml?token=session-secret",
    );
    expect(service.snapshot.programs).toEqual(programs);
    expect(service.snapshot.nextCheckAt).toBe(now + GUIDE_REFRESH_MS);
    expect(fetcher.mock.calls[0]).toEqual([
      "https://guide.example/list.xml?token=session-secret",
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "follow",
        cache: "no-cache",
      }),
    ]);
    expect(JSON.stringify(service.snapshot)).not.toMatch(/token|secret|https/);
    await service.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += GUIDE_REFRESH_MS;
    await service.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retains the last good schedule and backs off after errors or invalid replacements", async () => {
    let now = 100000;
    const fetcher = vi.fn(async () => new Response("xml"));
    const parse = vi.fn(() => programs);
    const service = new GuideService(fetcher, parse, () => now);
    await service.connect("https://guide.example/list.xml");
    now += GUIDE_REFRESH_MS;
    fetcher.mockRejectedValueOnce(
      new Error("URL and credentials must never become diagnostics"),
    );
    await service.check();
    expect(service.snapshot).toMatchObject({
      status: "error",
      programs,
      failures: 1,
      nextCheckAt: now + 60000,
    });
    now += 60000;
    parse.mockReturnValueOnce([]);
    await service.check();
    expect(service.snapshot).toMatchObject({
      status: "error",
      programs,
      failures: 2,
      nextCheckAt: now + 120000,
    });
    now += 120000;
    await service.check();
    expect(service.snapshot).toMatchObject({ status: "ready", failures: 0 });
  });
  it("coalesces overlapping requests, bounds manual retries and rejects oversized bodies", async () => {
    let now = 100000;
    const fetcher = vi.fn(
      async () =>
        new Response("xml", { headers: { "content-length": "10000001" } }),
    );
    const parse = vi.fn(() => programs);
    const service = new GuideService(fetcher, parse, () => now);
    const pending = service.connect("https://guide.example/list.xml");
    expect(service.check(true)).toBe(pending);
    await pending;
    expect(service.snapshot.status).toBe("error");
    expect(parse).not.toHaveBeenCalled();
    await service.check(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 15000;
    await service.check(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cannot restore a cleared or replaced guide through a late response", async () => {
    let respond!: (response: Response) => void;
    const fetcher = vi.fn(
      (_url: string, _options?: RequestInit) =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    const service = new GuideService(fetcher, () => programs);
    const old = service.connect("https://guide.example/private.xml");
    await Promise.resolve();
    const signal = fetcher.mock.calls[0][1]?.signal;
    service.import([{ ...programs[0], title: "Replacement file" }]);
    expect(signal?.aborted).toBe(true);
    respond(new Response("old private guide"));
    await old;
    expect(service.snapshot.programs[0].title).toBe("Replacement file");
    expect(service.snapshot.source).toBe("file");
    service.clear();
    expect(service.snapshot).toMatchObject({
      programs: [],
      source: "none",
      status: "empty",
    });
  });
  it("rejects insecure or executable connections without replacing the current guide", async () => {
    const service = new GuideService();
    service.import(programs);
    for (const url of [
      "javascript:alert(1)",
      "https://user:pass@guide.example/file.xml",
      "http://guide.example/file.xml",
      "https://guide.example/file.xml#bad",
    ]) {
      await expect(service.connect(url)).rejects.toThrow();
      expect(service.snapshot.programs).toEqual(programs);
    }
  });
  it("uses UTC for omitted zones and rejects impossible dates, times and offsets", () => {
    expect(xmltvTime("20261018120000")).toBe(Date.UTC(2026, 9, 18, 12));
    expect(xmltvTime("20261018123000 +0530")).toBe(Date.UTC(2026, 9, 18, 7));
    expect(xmltvTime("20261018123000 -0330")).toBe(Date.UTC(2026, 9, 18, 16));
    for (const stamp of [
      "20260230000000",
      "20261301000000",
      "20261018250000",
      "20261018120000 +1460",
      "20261018120000 +1500",
      "20261018120000 garbage",
    ])
      expect(xmltvTime(stamp)).toBeNaN();
  });
  it("follows a redirect to HTTPS and explains why a guide failed", async () => {
    const withRedirect = (url: string) =>
      Object.defineProperties(new Response("xml"), {
        redirected: { value: true },
        url: { value: url },
      });
    const redirected = withRedirect("https://raw.example/guide.xml");
    const ok = new GuideService(
      vi.fn(async () => redirected),
      vi.fn(() => programs),
      () => 1000,
    );
    await ok.connect("https://short.example/guide.xml");
    expect(ok.snapshot.status).toBe("ready");

    const downgraded = withRedirect("http://raw.example/guide.xml");
    const bad = new GuideService(
      vi.fn(async () => downgraded),
      vi.fn(() => programs),
      () => 1000,
    );
    await bad.connect("https://short.example/guide.xml");
    expect(bad.snapshot.status).toBe("error");
    expect(bad.snapshot.reason).toMatch(/not secure/);

    const blocked = new GuideService(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      vi.fn(() => programs),
      () => 1000,
    );
    await blocked.connect("https://short.example/guide.xml");
    expect(blocked.snapshot.reason).toMatch(/CORS/);
  });
  it("says a guide that never loaded hasn't loaded, with the real reason", async () => {
    let now = 1000;
    const fetcher = vi.fn(async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    const service = new GuideService(fetcher, vi.fn(() => programs), () => now);
    expect(guideStatusText({ ...service.snapshot, status: "loading" })).toBe(
      "Loading your guide…",
    );
    await service.connect("https://guide.example/list.xml");
    const failed = guideStatusText(service.snapshot);
    expect(failed).toMatch(/^The guide hasn’t loaded yet\. .*CORS/);
    expect(failed).not.toMatch(/last schedule/);

    fetcher.mockResolvedValueOnce(new Response("xml"));
    now += 16000;
    await service.check(true);
    expect(guideStatusText(service.snapshot)).toMatch(/^Updated /);
    expect(
      guideStatusText({ ...service.snapshot, status: "loading" }),
    ).toBe("Refreshing your guide…");
    now += 16000;
    await service.check(true);
    expect(guideStatusText(service.snapshot)).toBe(
      "Refresh unavailable · showing the last schedule",
    );
  });
  it("fetches through the TV app's host route, which follows redirects natively", async () => {
    expect(
      guideFetchUrl(
        "https://i.example/Guide/us.xml?x=1",
        true,
        "https://appassets.androidplatform.net",
      ),
    ).toBe("https://appassets.androidplatform.net/__https/i.example/Guide/us.xml?x=1");
    expect(guideFetchUrl("https://i.example/us.xml", false, "https://site")).toBe(
      "https://i.example/us.xml",
    );
    const hosted = (landed: string | null, status = 200, statusText = "OK") =>
      new GuideService(
        vi.fn(async () =>
          new Response("xml", {
            status,
            statusText,
            headers: landed ? { "x-open-tv-url": landed } : {},
          }),
        ),
        vi.fn(() => programs),
        () => 1000,
        (url) => `https://app.test/__https/${url.slice(8)}`,
      );
    const ok = hosted("https://raw.example/us.xml");
    await ok.connect("https://short.example/us.xml");
    expect(ok.snapshot.status).toBe("ready");
    const downgraded = hosted("http://raw.example/us.xml");
    await downgraded.connect("https://short.example/us.xml");
    expect(downgraded.snapshot.reason).toMatch(/not secure/);
    const unreachable = hosted(null, 502, "Could not reach the server");
    await unreachable.connect("https://short.example/us.xml");
    expect(unreachable.snapshot.reason).toMatch(/TV app could not reach/);
  });
});
