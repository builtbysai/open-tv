import { afterEach, describe, expect, it, vi } from "vitest";
import { NasaProvider, pickVideo } from "../src/providers/nasa";
afterEach(() => vi.unstubAllGlobals());
const make = () =>
  new NasaProvider({ id: "nasa-test", name: "NASA", query: "apollo" });
describe("NASA video library", () => {
  it("prefers the medium rendition and upgrades http to https", () => {
    expect(
      pickVideo([
        { href: "http://images-assets.nasa.gov/video/a/a~orig.mp4" },
        { href: "http://images-assets.nasa.gov/video/a/a~medium.mp4" },
        { href: "http://images-assets.nasa.gov/video/a/a~small.mp4" },
        { href: "http://evil.example/video/a~medium.mp4" },
      ]),
    ).toBe("https://images-assets.nasa.gov/video/a/a~medium.mp4");
    expect(pickVideo([{ href: "http://evil.example/x.mp4" }])).toBeUndefined();
  });
  it("lists videos without files and resolves a file on demand", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/search")
          ? new Response(
              JSON.stringify({
                collection: {
                  items: [
                    {
                      data: [
                        {
                          nasa_id: "KSC-1",
                          title: "Apollo 11 Launch",
                          description: "<b>Liftoff</b> of Apollo 11.",
                          date_created: "1969-07-16T00:00:00Z",
                        },
                      ],
                      links: [
                        {
                          href: "http://images-assets.nasa.gov/video/KSC-1/KSC-1~thumb.jpg",
                        },
                      ],
                    },
                    { data: [{ nasa_id: "bad id", title: "x" }] },
                  ],
                },
              }),
            )
          : new Response(
              JSON.stringify({
                collection: {
                  items: [
                    {
                      href: "http://images-assets.nasa.gov/video/KSC-1/KSC-1~medium.mp4",
                    },
                  ],
                },
              }),
            ),
      ),
    );
    const provider = make();
    const items = await provider.load();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Apollo 11 Launch",
      type: "documentary",
      availability: "external",
      year: 1969,
      description: "Liftoff of Apollo 11.",
    });
    const playable = await provider.resolve(items[0]);
    expect(playable.availability).toBe("playable");
    expect(playable.streams[0].url).toBe(
      "https://images-assets.nasa.gov/video/KSC-1/KSC-1~medium.mp4",
    );
  });
});
