import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerLibrary } from "../src/app/serverLibrary";
import type { MediaServer } from "../src/domain/servers";
const server = (id: string): MediaServer => ({
  id: `ot-${id}`,
  name: id,
  base: `https://${id}.example`,
  classification: "general",
  enabled: true,
});
const seed = { kind: "movie" as const, tmdbId: 7, title: "Seven", genres: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
afterEach(() => vi.unstubAllGlobals());
describe("server library", () => {
  it("asks every server on a background check, so each responder is listed", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return new Response("", { status: 200 });
      }),
    );
    const library = new ServerLibrary();
    library.setServers([server("a"), server("b")]);
    library.prefetch([seed]);
    await settle();
    expect(asked).toHaveLength(2);
    expect(library.hostsFor("movie", 7).map((s) => s.id)).toEqual([
      "ot-a",
      "ot-b",
    ]);
    library.ensure(seed);
    await settle();
    expect(asked).toHaveLength(2);
    expect(library.items()[0].streams).toHaveLength(2);
  });
  it("keeps misses out of the library and skips servers that cannot answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://a.")
          ? new Response("", { status: 404 })
          : Promise.reject(new TypeError("cors")),
      ),
    );
    const library = new ServerLibrary();
    library.setServers([server("a"), server("b")]);
    library.ensure(seed);
    await settle();
    expect(library.items()).toEqual([]);
  });
  it("drops a server that failed to return the title when it was opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const library = new ServerLibrary();
    library.setServers([server("a"), server("b")]);
    library.ensure(seed);
    await settle();
    expect(library.items()[0].streams).toHaveLength(2);
    library.reject(library.items()[0].streams[0].url);
    expect(library.items()[0].streams).toHaveLength(1);
  });
  it("lists servers that failed before after the ones that did not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const library = new ServerLibrary();
    library.setServers([server("a"), server("b")]);
    library.ensure(seed);
    await settle();
    expect(library.hostsFor("movie", 7).map((s) => s.id)).toEqual([
      "ot-a",
      "ot-b",
    ]);
    library.reject("https://a.example/embed/movie/7");
    expect(library.hostsFor("movie", 7).map((s) => s.id)).toEqual(["ot-b"]);
    // On another title both answer, but the server that failed is offered last.
    library.ensure({ ...seed, tmdbId: 8 });
    await settle();
    expect(library.hostsFor("movie", 8).map((s) => s.id)).toEqual([
      "ot-b",
      "ot-a",
    ]);
  });
  it("remembers results between sessions", async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const first = new ServerLibrary(storage);
    first.setServers([server("a")]);
    first.ensure(seed);
    await settle();
    const second = new ServerLibrary(storage);
    second.setServers([server("a")]);
    expect(second.items().map((i) => i.title)).toEqual(["Seven"]);
  });
});
