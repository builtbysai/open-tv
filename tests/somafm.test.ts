import { afterEach, describe, expect, it, vi } from "vitest";
import { SomaFmProvider, parsePls } from "../src/providers/somafm";
afterEach(() => vi.unstubAllGlobals());
describe("SomaFM", () => {
  it("reads stream addresses from a pls file and drops non-https ones", () => {
    expect(
      parsePls(
        "[playlist]\nFile1=https://ice1.somafm.com/a-128-mp3\nFile2=http://x/y\nTitle1=A\nFile3=https://ice2.somafm.com/a-128-mp3\r\n",
      ),
    ).toEqual([
      "https://ice1.somafm.com/a-128-mp3",
      "https://ice2.somafm.com/a-128-mp3",
    ]);
  });
  it("turns channels into audio stations with their streams", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("channels.json")
          ? new Response(
              JSON.stringify({
                channels: [
                  {
                    id: "groovesalad",
                    title: "Groove Salad",
                    genre: "ambient|electronic",
                    description: "A nicely chilled plate of ambient beats.",
                    image: "https://api.somafm.com/logos/120/g.png",
                    playlists: [
                      {
                        url: "https://api.somafm.com/groovesalad.pls",
                        format: "mp3",
                        quality: "highest",
                      },
                    ],
                  },
                  { id: "bad id", title: "Skipped", playlists: [] },
                ],
              }),
            )
          : new Response(
              "[playlist]\nFile1=https://ice1.somafm.com/groovesalad-128-mp3\n",
            ),
      ),
    );
    const items = await new SomaFmProvider().load();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "SomaFM Groove Salad",
      type: "radio",
      genres: ["ambient", "electronic"],
      availability: "playable",
    });
    expect(items[0].streams[0]).toEqual({
      url: "https://ice1.somafm.com/groovesalad-128-mp3",
      format: "audio",
    });
  });
  it("fails instead of returning an empty list when no playlist answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("channels.json")
          ? new Response(
              JSON.stringify({
                channels: [
                  {
                    id: "groovesalad",
                    title: "Groove Salad",
                    playlists: [
                      {
                        url: "https://api.somafm.com/groovesalad.pls",
                        format: "mp3",
                        quality: "highest",
                      },
                    ],
                  },
                ],
              }),
            )
          : new Response("busy", { status: 503 }),
      ),
    );
    await expect(new SomaFmProvider().load()).rejects.toThrow(/did not answer/);
  });
});
