import { expect, test } from "@playwright/test";
import { BRIDGE, REFUSE, SILENT, frameVideo, openAndPlay, tvPage } from "./helpers";

// Only the TV, driven the way a TV remote drives it: arrows, OK, Back. No pointer.
test.describe("TV remote keys", () => {
  test("browse, open a title, play, and Back out, with focus always visible", async ({ browser }) => {
    const { page } = await tvPage(browser);
    await expect(page.locator(".rail h2").first()).toBeVisible();
    // Focus starts on content (the first poster), not the top bar.
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-f"))).toContain("movies:movie:603");

    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".hero h1")).toHaveText("Blade Runner");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp"); // up from the first row reaches the top bar
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-f"))).toMatch(/^bar:/);
    await page.keyboard.press("ArrowDown");

    await page.keyboard.press("Enter");
    await expect(page.locator(".details h1")).toHaveText("The Matrix");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-f"))).toBe("d:play");
    await page.keyboard.press("Enter");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${BRIDGE}/embed/movie/603`);
    await expect.poll(async () => (await frameVideo(page, 4181)).paused, { timeout: 15_000 }).toBe(false);

    // Back from the player returns to the title page, Back again to the home screen, where
    // focus returns to the poster that was chosen.
    await page.keyboard.press("Escape");
    await expect(page.locator("iframe.embed-frame")).toHaveCount(0);
    await expect(page.locator(".details h1")).toHaveText("The Matrix");
    await page.keyboard.press("Escape");
    await expect(page.locator(".rail h2").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-f"))).toContain("movies:movie:603");
  });

  test("with the HUD hidden, OK pauses and the arrows seek (through the bridge)", async ({ browser }) => {
    const { page } = await tvPage(browser);
    await openAndPlay(page, "The Matrix");
    await expect.poll(async () => (await frameVideo(page, 4181)).paused, { timeout: 15_000 }).toBe(false);
    await expect(page.locator(".hud")).toHaveCount(0, { timeout: 8000 }); // auto-hides while playing
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await frameVideo(page, 4181)).paused).toBe(true);
    const t = (await frameVideo(page, 4181)).time;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await frameVideo(page, 4181)).time).toBeGreaterThan(t + 8);
  });

  test("a server without the bridge still plays, and the TV says what it cannot do", async ({ browser }) => {
    const { page } = await tvPage(browser, { servers: [{ id: "silent1", name: "Silent", base: SILENT }] });
    await openAndPlay(page, "The Matrix");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${SILENT}/embed/movie/603`);
    await expect.poll(async () => (await frameVideo(page, 4182)).paused, { timeout: 15_000 }).toBe(false);
    // After a few seconds of silence the TV knows it cannot control this server.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByText("does not take remote controls")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Video controls" })).toBeVisible();
  });

  test("a server known to speak the bridge that never answers fails over to the next", async ({ browser }) => {
    // "refuse" sends X-Frame-Options: DENY. A refused frame fires `load` like any other, so the
    // only proof of failure is a bridge server that stays silent.
    const { page } = await tvPage(browser, {
      servers: [
        { id: "refuse1", name: "Refuses", base: REFUSE, bridge: "yes" },
        { id: "bridge1", name: "Bridge", base: BRIDGE },
      ],
    });
    await openAndPlay(page, "The Matrix");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${REFUSE}/embed/movie/603`);
    await expect(page.getByText("This server did not work")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Try next server" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${BRIDGE}/embed/movie/603`);
    await expect.poll(async () => (await frameVideo(page, 4181)).paused, { timeout: 15_000 }).toBe(false);
  });

  test("the server panel switches server", async ({ browser }) => {
    const { page } = await tvPage(browser, {
      servers: [
        { id: "bridge1", name: "Bridge", base: BRIDGE },
        { id: "silent1", name: "Silent", base: SILENT },
      ],
    });
    await openAndPlay(page, "The Matrix");
    await expect.poll(async () => (await frameVideo(page, 4181)).paused, { timeout: 15_000 }).toBe(false);
    await page.keyboard.press("ArrowDown"); // wake the HUD
    await page.getByRole("button", { name: /Servers/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /Silent/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${SILENT}/embed/movie/603`);
  });

  test("finishing an episode offers the next one", async ({ browser }) => {
    const { page } = await tvPage(browser);
    await page.getByRole("button", { name: "Breaking Bad" }).first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".details h1")).toHaveText("Breaking Bad");
    await page.getByRole("button", { name: /1\. Episode 1/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${BRIDGE}/embed/tv/1396/1/1`);
    await expect.poll(async () => (await frameVideo(page, 4181)).paused, { timeout: 15_000 }).toBe(false);
    // Jump to the end of the clip: the page reports `ended` and the TV offers episode 2.
    await page.frames().find((f) => f.url().includes(":4181/embed/"))!.evaluate(() => {
      const v = document.querySelector("video")!;
      v.currentTime = v.duration - 0.3;
    });
    await expect(page.getByText("Up next")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Play now" }).press("Enter");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${BRIDGE}/embed/tv/1396/1/2`);
  });
});
