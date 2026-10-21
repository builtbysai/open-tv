import { test, expect } from "./viewer-test";
import { readFile } from "node:fs/promises";
import path from "node:path";
test("plays real MSE HLS with quality, audio and subtitle controls and cleans up on close", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type: string) {
      return /mpegurl/i.test(type) ? "" : original.call(this, type);
    };
  });
  const root = path.resolve("e2e/fixtures/hls");
  await page.route("https://hls-fixture.test/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    const body = await readFile(path.join(root, name));
    await route.fulfill({
      status: 200,
      body,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": name.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : name.endsWith(".vtt")
            ? "text/vtt"
            : "video/mp2t",
      },
    });
  });
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("HLS fixture");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://hls-fixture.test/master.m3u8");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("HLS fixture");
  await page
    .getByRole("button", { name: "Details for HLS fixture", exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect
    .poll(() => page.locator("video").evaluate((video) => video.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.5);
  await expect(
    page.getByRole("combobox", { name: "Video quality", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Video quality", exact: true })
    .selectOption({ label: "180p" });
  await page
    .getByRole("combobox", { name: "Audio track", exact: true })
    .selectOption({ label: "Spanish" });
  await page
    .getByRole("combobox", { name: "Subtitles", exact: true })
    .selectOption({ label: "English captions" });
  const shortcuts = page.getByRole("button", {
    name: "Playback shortcuts",
    exact: true,
  });
  await expect(shortcuts).toHaveAttribute("aria-expanded", "false");
  await shortcuts.click();
  await expect(page.locator("#playback-shortcuts")).toContainText(
    "Space: pause",
  );
  await shortcuts.click();
  await expect(page.locator("#playback-shortcuts")).toHaveCount(0);
  await expect(page.locator(".player-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Close player", exact: true }).click();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toBeVisible();
});
