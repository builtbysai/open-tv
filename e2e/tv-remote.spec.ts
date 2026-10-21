import { test, expect } from "./viewer-test";
import type { Page } from "@playwright/test";
import { addClip } from "./clip-fixture";

// The onn remote has a D-pad, OK, Back and a channel rocker, nothing else. The Android app
// turns Back into a cancelable 'opentv:back' event and the rocker into MediaTrackNext/Previous.
const back = (page: Page) =>
  page.evaluate(
    () => !window.dispatchEvent(new Event("opentv:back", { cancelable: true })),
  );
const focused = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute("aria-label") ||
      document.activeElement?.textContent?.trim() ||
      "",
  );
const time = (page: Page) =>
  page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime);
const paused = (page: Page) =>
  page.locator("video").evaluate((v: HTMLVideoElement) => v.paused);
// Presses one arrow until focus lands on a control whose name matches.
async function moveTo(page: Page, key: string, name: RegExp) {
  for (let i = 0; i < 12 && !name.test(await focused(page)); i++)
    await page.keyboard.press(key);
  expect(await focused(page)).toMatch(name);
}
// The details dialog opens on Close; Watch now is down, left and up from there.
async function watchNow(page: Page) {
  await expect(page.locator("dialog.detail-dialog")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await moveTo(page, "ArrowUp", /^Watch now$/);
  await page.keyboard.press("Enter");
}
async function openOnTv(page: Page) {
  await addClip(page);
  await addClip(page, "Second clip");
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/?tv=1#/library");
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  // Setup ends here: from the title card on, only remote keys are used.
  await page
    .getByRole("button", { name: "Details for Remote clip", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await watchNow(page);
  const player = page.locator("dialog.player-dialog");
  await expect(player).toBeVisible();
  await expect.poll(() => time(page)).toBeGreaterThan(0.2);
  await expect(page.locator(".tv-play-surface")).toBeFocused();
  return player;
}

test("the whole player works from the remote alone", async ({ page }) => {
  const player = await openOnTv(page);
  // Pause and resume with OK on the picture.
  await page.keyboard.press("Enter");
  await expect.poll(() => paused(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect.poll(() => paused(page)).toBe(false);
  await page.keyboard.press("Enter");
  await expect.poll(() => paused(page)).toBe(true);
  // Seek: each press moves a shown target, the jump follows a short pause.
  const start = await time(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Seeking to")).toHaveText(
    `0:${String(Math.floor(start + 20)).padStart(2, "0")}`,
  );
  expect(await time(page)).toBeLessThan(start + 1);
  await expect.poll(() => time(page)).toBeGreaterThan(start + 19);
  await expect(page.getByLabel("Seeking to")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => time(page)).toBeLessThan(start + 11);
  expect(await time(page)).toBeGreaterThan(start + 9);
  // The seek bar seeks the same way; Left/Right there never leave it.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("slider", { name: "Seek video" })).toBeFocused();
  const before = await time(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("slider", { name: "Seek video" })).toBeFocused();
  await expect.poll(() => time(page)).toBeGreaterThan(before + 9);
  // Down to the button row; Left/Right move between buttons there.
  await page.keyboard.press("ArrowDown");
  await moveTo(page, "ArrowLeft", /^Play$/);
  await page.keyboard.press("Enter");
  await expect.poll(() => paused(page)).toBe(false);
  // Sleep timer: opens, is navigable, closes with Back without closing the player.
  await moveTo(page, "ArrowRight", /^Sleep timer$/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Sleep timer" })).toBeVisible();
  await expect.poll(() => focused(page)).toBe("15 min");
  await page.keyboard.press("ArrowRight");
  expect(await focused(page)).toBe("30 min");
  expect(await back(page)).toBe(true);
  await expect(page.getByRole("group", { name: "Sleep timer" })).toHaveCount(0);
  expect(await focused(page)).toBe("Sleep timer");
  await expect(player).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe("15 min");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pc-badge")).toHaveText(/^1[45] min$/);
  // Fullscreen: in, then Back leaves it without closing the player.
  await moveTo(page, "ArrowRight", /^Fullscreen$/);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.className ?? ""),
    )
    .toContain("player-shell");
  await expect(page.locator(".tv-play-surface")).toBeFocused();
  expect(await back(page)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement))
    .toBeNull();
  await expect(player).toBeVisible();
  // The channel rocker changes title.
  await page.keyboard.press("MediaTrackNext");
  await expect(player.locator("h2")).not.toHaveText("Remote clip");
  await page.keyboard.press("MediaTrackPrevious");
  await expect(player.locator("h2")).toHaveText("Remote clip");
  // Back closes the player.
  await page.waitForTimeout(700);
  expect(await back(page)).toBe(true);
  await expect(player).toBeHidden();
});

test("fullscreen hides all chrome after 3 s; an arrow wakes it; Back wakes, then leaves fullscreen, never closing", async ({
  page,
}) => {
  const player = await openOnTv(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await moveTo(page, "ArrowRight", /^Fullscreen$/);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.className ?? ""),
    )
    .toContain("player-shell");
  const bar = page.locator(".player-bar");
  const close = page.getByRole("button", { name: "Close player" });
  const controls = page.locator(".player-controls");
  const cursor = () =>
    page
      .locator(".player-stage")
      .evaluate((stage) => getComputedStyle(stage).cursor);
  await expect(close).toBeVisible();
  await page.waitForTimeout(3300);
  await expect(bar).toBeHidden();
  await expect(close).toBeHidden();
  await expect(controls).toBeHidden();
  expect(await cursor()).toBe("none");
  // The picture fills the screen: no leftover bar takes room from it.
  const stage = await page.locator(".player-stage").boundingBox();
  expect(stage?.height).toBe(540);
  // One arrow wakes the chrome and moves nothing.
  await page.keyboard.press("ArrowDown");
  await expect(close).toBeVisible();
  await expect(controls).toBeVisible();
  await expect(page.locator(".tv-play-surface")).toBeFocused();
  expect(await cursor()).not.toBe("none");
  // While focus is in the controls they stay, however long.
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(3300);
  await expect(controls).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".tv-play-surface")).toBeFocused();
  await page.waitForTimeout(3300);
  await expect(close).toBeHidden();
  // Back with the chrome hidden only wakes it.
  expect(await back(page)).toBe(true);
  await expect(close).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
  // The next Back leaves fullscreen; the player stays.
  expect(await back(page)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement))
    .toBeNull();
  await expect(player).toBeVisible();
  await expect(page.locator("video")).toHaveCount(1);
});

test("an embedded player that starts muted is asked to unmute, and our chrome says when sound is off", async ({
  page,
}) => {
  await page.route("https://muted-fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>
        window.unmutes = 0; let muted = true, t = 0;
        const say = (m) => parent.postMessage({ source: "opentv", ...m }, "*");
        addEventListener("message", (e) => {
          if (e.data?.source !== "opentv-host" || e.data.action !== "unmute") return;
          window.unmutes++;
          // The first request is refused, the way an autoplay policy can.
          if (window.unmutes > 1) { muted = false; say({ type: "mute", muted }); }
        });
        say({ type: "ready" });
        say({ type: "mute", muted: true });
        say({ type: "playing" });
        setInterval(() => say({ type: "timeupdate", time: (t += 0.25), duration: 600 }), 250);
      </script>`,
    }),
  );
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  const form = page.getByRole("form", { name: "Add media server" });
  await form.getByRole("textbox", { name: "Server name" }).fill("Muted server");
  await form
    .getByRole("textbox", { name: "Server address" })
    .fill("https://muted-fixture.test");
  await form
    .getByRole("combobox", { name: "Server content" })
    .selectOption("general");
  await form.getByLabel("I am authorized to use this server").check();
  await form.getByRole("button", { name: "Create server" }).click();
  const media = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await media
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Muted title");
  await media
    .getByRole("combobox", { name: "Playback source" })
    .selectOption({ label: "Muted server" });
  await media.getByRole("textbox", { name: "Provider title ID" }).fill("tt123");
  await media
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await media.getByLabel("I have permission to access this media").check();
  await media.getByRole("button", { name: "Add media", exact: true }).click();
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/?tv=1#/library");
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Muted title", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await watchNow(page);
  const frame = page.frameLocator(".player-stage iframe");
  await expect(frame.locator("body")).toBeAttached();
  const unmutes = () =>
    page
      .frames()
      .find((f) => f.url().startsWith("https://muted-fixture.test"))!
      .evaluate(() => (window as unknown as { unmutes: number }).unmutes);
  // Asked once, automatically, after playback started.
  await expect.poll(unmutes).toBe(1);
  // Still muted: our own chrome says so and offers Unmute, reachable with the D-pad.
  const unmute = page.getByRole("button", {
    name: "Sound is off in this player. Unmute",
  });
  await expect(unmute).toBeVisible();
  await moveTo(page, "ArrowUp", /^Sound is off in this player\. Unmute$/);
  await page.keyboard.press("Enter");
  await expect.poll(unmutes).toBe(2);
  await expect(unmute).toHaveCount(0);
});
