import { test, expect } from "./viewer-test";
import type { Page } from "@playwright/test";

const BASE = "https://music-fixture.test";
const song = {
  type: "video",
  videoId: "abcDEF12345",
  title: "Band - Fixture Song (Official Video)",
  author: "Band - Topic",
  lengthSeconds: 10,
  videoThumbnails: [],
};
// Ten seconds of silence, which every browser can play.
function wav(seconds = 10) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const cors = { "access-control-allow-origin": "*" };
async function instance(page: Page, base = BASE, working = true) {
  await page.route(`${base}/**`, (route) => {
    const url = new URL(route.request().url());
    if (!working)
      return route.fulfill({ status: 500, headers: cors, body: "down" });
    if (
      url.pathname === "/api/v1/trending" ||
      url.pathname === "/api/v1/search"
    )
      return route.fulfill({ json: [song], headers: cors });
    if (url.pathname.startsWith("/api/v1/videos/"))
      return route.fulfill({
        json: {
          adaptiveFormats: [
            { type: "audio/wav", url: `${base}/audio.wav`, bitrate: 128000 },
          ],
        },
        headers: cors,
      });
    if (url.pathname === "/audio.wav")
      return route.fulfill({
        body: wav(),
        contentType: "audio/wav",
        headers: cors,
      });
    if (url.pathname.startsWith("/embed/"))
      return route.fulfill({
        contentType: "text/html",
        body: "<h1>Embedded player</h1>",
      });
    return route.fulfill({ status: 404, body: "" });
  });
}
async function addProvider(page: Page, name: string, base: string) {
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  const form = page.getByRole("form", { name: "Add music provider" });
  await form.getByRole("textbox", { name: "Name" }).fill(name);
  await form.getByRole("textbox", { name: "Address" }).fill(base);
  await form.getByRole("button", { name: "Add provider" }).click();
}

// The Internet Archive is built in: its search, metadata and files are stood in for here.
async function archiveMusic(page: Page) {
  const item = "fixture-band1999-01-01.sbd";
  const downloads: string[] = [];
  await page.route("https://archive.org/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/advancedsearch.php")
      return route.fulfill({
        headers: cors,
        json: {
          response: {
            docs: [
              {
                identifier: item,
                title: "Fixture Band Live on 1999-01-01",
                creator: "Fixture Band",
              },
            ],
          },
        },
      });
    if (url.pathname === `/metadata/${item}/files`)
      return route.fulfill({
        headers: cors,
        json: {
          result: [
            { name: "fb-d1t02.mp3", format: "VBR MP3", track: "2" },
            { name: "fb-d1t01.mp3", format: "VBR MP3", track: "1" },
            { name: "fb-d1t01.ogg", format: "Ogg Vorbis" },
          ],
        },
      });
    if (url.pathname.startsWith(`/download/${item}/`)) {
      downloads.push(url.pathname);
      return route.fulfill({
        body: wav(),
        contentType: "audio/wav",
        headers: cors,
      });
    }
    return route.fulfill({ status: 404, headers: cors, body: "" });
  });
  return downloads;
}

test("Music works with nothing set up: the built-in Internet Archive browses, searches and plays", async ({
  page,
}) => {
  const downloads = await archiveMusic(page);
  await page.goto("/#/music");
  await expect(
    page.getByRole("heading", { name: "Music needs a provider" }),
  ).toHaveCount(0);
  const trending = page.getByRole("region", { name: "Trending music" });
  await expect(trending).toContainText("Fixture Band Live");
  await expect(trending).toContainText("Internet Archive");
  await page.getByRole("searchbox", { name: "Search songs" }).fill("fixture");
  await page.getByRole("searchbox", { name: "Search songs" }).press("Enter");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.locator(".song-row")).toHaveCount(1);
  await expect(results.locator(".song-source")).toHaveText("Internet Archive");
  await results.getByRole("button", { name: /^Play / }).click();
  const stage = page.locator(".audio-stage");
  await expect(
    stage.getByRole("heading", { name: /Fixture Band Live/ }).first(),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0.3);
  expect(downloads[0]).toBe(
    "/download/fixture-band1999-01-01.sbd/fb-d1t01.mp3",
  );
  await page.goto("/#/settings");
  await expect(page.locator("#music-providers")).toContainText(
    "The Internet Archive is built in",
  );
  await expect(page.locator("#music-providers .source-row")).toHaveCount(0);
});
test("results from Audius and the Internet Archive come together, each labelled", async ({
  page,
}) => {
  await archiveMusic(page);
  await page.route("https://api.audius.co/**", (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            id: "vZJJz",
            title: "Open Song",
            duration: 100,
            is_streamable: true,
            user: { name: "Open Artist" },
          },
        ],
      },
    }),
  );
  await page.goto("/#/music");
  await page.getByRole("button", { name: "Use Audius" }).click();
  await page.getByRole("searchbox", { name: "Search songs" }).fill("open");
  await page.getByRole("searchbox", { name: "Search songs" }).press("Enter");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.locator(".song-row")).toHaveCount(2);
  await expect(
    results.locator(".song-row", { hasText: "Open Song" }),
  ).toContainText("Audius");
  await expect(
    results.locator(".song-row", { hasText: "Fixture Band Live" }),
  ).toContainText("Internet Archive");
});
test("a provider is checked when added, shows trending and search, and plays a song with lyrics and album details", async ({
  page,
}) => {
  await instance(page);
  await page.route("https://lrclib.net/**", (route) =>
    route.fulfill({
      json: {
        syncedLyrics:
          "[00:00.50] First lyric line\n[00:04.00] Second lyric line",
        plainLyrics: "x",
      },
      headers: cors,
    }),
  );
  await page.route("https://musicbrainz.org/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/recording")
        ? {
            recordings: [
              {
                score: 100,
                releases: [
                  {
                    id: "11111111-2222-3333-4444-555555555555",
                    title: "Fixture Album",
                  },
                ],
                "artist-credit": [
                  { artist: { id: "66666666-7777-8888-9999-000000000000" } },
                ],
              },
            ],
          }
        : { type: "Group", country: "GB" },
      headers: cors,
    }),
  );
  await page.route("https://coverartarchive.org/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/#/settings");
  await addProvider(page, "Fixture instance", BASE);
  const row = page.locator("#music-providers .source-row");
  await expect(row).toContainText("Answering");
  await page.reload();
  await expect(page.locator("#music-providers .source-row")).toContainText(
    "checked",
  );
  await page.goto("/#/music");
  await expect(
    page.getByRole("region", { name: "Trending music" }),
  ).toContainText("Fixture Song");
  await page.getByRole("searchbox", { name: "Search songs" }).fill("fixture");
  await page.getByRole("searchbox", { name: "Search songs" }).press("Enter");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results).toContainText("Fixture Song");
  await results.getByRole("button", { name: /^Play / }).click();
  const player = page.getByRole("dialog");
  await expect(
    player.getByRole("heading", { name: /Fixture Song/ }).first(),
  ).toBeVisible();
  await expect(player).toContainText("Fixture Album");
  await player.getByRole("button", { name: "Lyrics" }).click();
  await expect(player.getByText("First lyric line")).toBeVisible();
  await player.getByRole("button", { name: "Visualizer" }).click();
  await expect(player.getByText("First lyric line")).toHaveCount(0);
});
test("a dead provider is skipped and the next one answers", async ({
  page,
}) => {
  await instance(page, "https://dead-fixture.test", false);
  await instance(page);
  await page.goto("/#/settings");
  await addProvider(page, "Dead one", "https://dead-fixture.test");
  await addProvider(page, "Live one", BASE);
  await expect(
    page.locator("#music-providers .source-row").first(),
  ).toContainText("Not answering");
  await page.goto("/#/music");
  await expect(
    page.getByRole("region", { name: "Trending music" }),
  ).toContainText("Fixture Song");
});
test("when every provider is down, Music says so and points at the addresses", async ({
  page,
}) => {
  await instance(page, BASE, false);
  await page.route("https://archive.org/**", (route) =>
    route.fulfill({ status: 500, headers: cors, body: "down" }),
  );
  await page.goto("/#/settings");
  await addProvider(page, "Down", BASE);
  await page.goto("/#/music");
  await expect(page.getByRole("alert")).toContainText(
    "No music provider is answering",
  );
  await expect(
    page.getByRole("button", { name: "Check provider addresses" }),
  ).toBeVisible();
});
test("a song whose audio will not play can open the provider's player page", async ({
  page,
}) => {
  await instance(page);
  await page.route(`${BASE}/audio.wav`, (route) =>
    route.fulfill({ status: 500, body: "no", headers: cors }),
  );
  await page.goto("/#/settings");
  await addProvider(page, "Fixture instance", BASE);
  await page.goto("/#/music");
  await page
    .getByRole("region", { name: "Trending music" })
    .getByRole("button", { name: /^Play / })
    .click();
  await page.getByRole("button", { name: "Open the player page" }).click();
  await expect(page.locator(".player-stage iframe")).toHaveAttribute(
    "src",
    /music-fixture\.test\/embed\/abcDEF12345/,
  );
});
test("Radio and Music share one Listen entry in the menu", async ({ page }) => {
  await page.goto("/#/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("button", { name: "Music" })).toHaveCount(0);
  await nav.getByRole("button", { name: "Listen" }).click();
  const tabs = page.getByRole("navigation", { name: "Listen" });
  await expect(
    tabs.getByRole("button", { name: "Radio & audio" }),
  ).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("button", { name: "Music" }).click();
  await expect(page).toHaveURL(/#\/music/);
  await expect(nav.getByRole("button", { name: "Listen" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("one tap adds Audius, which then answers with trending songs", async ({
  page,
}) => {
  await page.route("https://api.audius.co/**", (route) =>
    route.fulfill({
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "vZJJz",
            title: "Open Song",
            duration: 100,
            is_streamable: true,
            user: { name: "Open Artist" },
          },
        ],
      }),
    }),
  );
  await page.goto("/#/music");
  await page.getByRole("button", { name: "Use Audius" }).click();
  await expect(page.getByText("Open Song").first()).toBeVisible();
});
