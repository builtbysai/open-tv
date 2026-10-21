import { test, expect } from "./viewer-test";
import type { Locator, Page } from "@playwright/test";

// The audio player on short desktop windows: every control stays inside the window and
// on top, with the queue and the lyrics open as well.
const BASE = "https://music-layout.test";
const cors = { "access-control-allow-origin": "*" };
const songs = Array.from({ length: 6 }, (_, i) => ({
  type: "video",
  videoId: `layoutSong${i}`,
  title: `Band - Layout Song ${i + 1} (Official Video)`,
  author: "Band - Topic",
  lengthSeconds: 30,
  videoThumbnails: [{ quality: "medium", url: `${BASE}/art.png` }],
}));
function wav(seconds = 30) {
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
// A 1x1 PNG, stretched to the artwork's square.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
async function fixtures(page: Page) {
  await page.route(`${BASE}/**`, (route) => {
    const url = new URL(route.request().url());
    if (["/api/v1/trending", "/api/v1/search"].includes(url.pathname))
      return route.fulfill({ json: songs, headers: cors });
    if (url.pathname.startsWith("/api/v1/videos/"))
      return route.fulfill({
        json: {
          adaptiveFormats: [
            { type: "audio/wav", url: `${BASE}/audio.wav`, bitrate: 128000 },
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
    if (url.pathname === "/art.png")
      return route.fulfill({ body: png, contentType: "image/png" });
    return route.fulfill({ status: 404, body: "" });
  });
  const lines = Array.from(
    { length: 40 },
    (_, i) =>
      `[00:${String(i).padStart(2, "0")}.00] Lyric line number ${i + 1}`,
  ).join("\n");
  await page.route("https://lrclib.net/**", (route) =>
    route.fulfill({
      json: { syncedLyrics: lines, plainLyrics: "x" },
      headers: cors,
    }),
  );
  for (const host of [
    "https://musicbrainz.org/**",
    "https://coverartarchive.org/**",
  ])
    await page.route(host, (route) => route.fulfill({ status: 404, body: "" }));
}
// Inside the window, and the topmost thing at its centre (so nothing covers it).
async function expectReachable(page: Page, control: Locator, label: string) {
  const viewport = page.viewportSize()!;
  const box = await control.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  expect(box!.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${label} top`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(
    viewport.width + 0.5,
  );
  expect(box!.y + box!.height, `${label} bottom`).toBeLessThanOrEqual(
    viewport.height + 0.5,
  );
  const onTop = await control.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const corners = [
      [r.left + 2, r.top + 2],
      [r.right - 2, r.top + 2],
      [r.left + 2, r.bottom - 2],
      [r.right - 2, r.bottom - 2],
      [r.left + r.width / 2, r.top + r.height / 2],
    ];
    return corners.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return (
        !!hit &&
        (element === hit || element.contains(hit) || hit.contains(element))
      );
    });
  });
  expect(onTop, `${label} is not covered or clipped`).toBe(true);
}
async function expectAllControls(page: Page) {
  const player = page.getByRole("dialog");
  const controls = player.locator(
    ".audio-controls button, .audio-controls input, .audio-controls output, .audio-controls label.button, .pc-tools button, .player-bar button",
  );
  const count = await controls.count();
  expect(count).toBeGreaterThan(8);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const name =
      (await control.getAttribute("aria-label")) ||
      (await control.textContent())?.trim() ||
      `control ${i}`;
    await expectReachable(page, control, name);
  }
}
// The middle of the stage may scroll, but whatever is scrolled to is fully shown.
async function expectScrolledInto(page: Page, control: Locator, label: string) {
  await control.scrollIntoViewIfNeeded();
  await expectReachable(page, control, label);
}
for (const height of [600, 720, 900])
  test(`audio controls stay inside a 1280x${height} window with the queue and lyrics open`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height });
    await fixtures(page);
    await page.goto("/#/settings");
    await page
      .getByRole("button", { name: "Add provider", exact: true })
      .click();
    const form = page.getByRole("form", { name: "Add music provider" });
    await form.getByRole("textbox", { name: "Name" }).fill("Layout");
    await form.getByRole("textbox", { name: "Address" }).fill(BASE);
    await form.getByRole("button", { name: "Add provider" }).click();
    await expect(page.locator("#music-providers .source-row")).toContainText(
      "Answering",
    );
    await page.goto("/#/music");
    await page.getByRole("searchbox", { name: "Search songs" }).fill("layout");
    await page.getByRole("searchbox", { name: "Search songs" }).press("Enter");
    const results = page.getByRole("region", { name: "Search results" });
    for (let i = 2; i <= 6; i++)
      await results
        .getByRole("button", {
          name: new RegExp(`^Add .*Layout Song ${i} .*to the queue`),
        })
        .click();
    await results
      .getByRole("button", { name: /^Play .*Layout Song 1 / })
      .click();
    const player = page.getByRole("dialog");
    const stage = player.locator(".audio-stage");
    await expect(
      stage.getByRole("heading", { name: /Layout Song 1/ }),
    ).toBeVisible();
    await expect(
      stage.getByRole("slider", { name: "Seek audio" }),
    ).toBeVisible();
    await expectAllControls(page);
    const heading = stage.getByRole("heading", { name: /Layout Song 1/ });
    await expectScrolledInto(page, heading, "title");
    const art = await stage.locator(".audio-art").boundingBox();
    const transport = await stage.locator(".audio-controls").boundingBox();
    expect(art!.y + art!.height).toBeLessThanOrEqual(transport!.y);

    const upNext = stage.getByRole("button", { name: /Up next/ });
    await expectScrolledInto(page, upNext, "Up next");
    await upNext.click();
    await expect(stage.getByRole("list", { name: "Up next" })).toBeVisible();
    await expectAllControls(page);
    await expectScrolledInto(
      page,
      stage.getByRole("button", { name: /^Remove .*Layout Song 6/ }),
      "last queue entry",
    );
    await expectScrolledInto(
      page,
      stage.getByRole("button", { name: "Clear queue" }),
      "Clear queue",
    );

    await stage.getByRole("button", { name: "Lyrics" }).click();
    await expect(
      stage.getByText("Lyric line number 1", { exact: true }),
    ).toBeVisible();
    await expectAllControls(page);
    await expectScrolledInto(page, heading, "title with lyrics");

    // The slider and the clock read the same second.
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(1.2);
    await stage.getByRole("button", { name: "Pause audio" }).click();
    await expect(
      stage.getByRole("button", { name: "Play audio" }),
    ).toBeVisible();
    const slider = await stage
      .getByRole("slider", { name: "Seek audio" })
      .inputValue();
    const time = await stage.getByLabel("Playback time").textContent();
    const [m, s] = time!.split(" / ")[0].split(":").map(Number);
    expect(m * 60 + s).toBe(Number(slider));
  });
