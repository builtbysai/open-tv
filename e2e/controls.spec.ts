import { test, expect } from "./viewer-test";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const clip = readFileSync(new URL("./fixtures/clip.webm", import.meta.url));
async function playClip(page: Page) {
  await page.route("https://video-fixture.test/**", (route) => {
    const range = route.request().headers()["range"];
    const headers = {
      "content-type": "video/webm",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    };
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)!;
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : clip.length - 1;
      return route.fulfill({
        status: 206,
        body: clip.subarray(start, end + 1),
        headers: {
          ...headers,
          "content-range": `bytes ${start}-${end}/${clip.length}`,
        },
      });
    }
    return route.fulfill({ status: 200, body: clip, headers });
  });
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Control clip");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://video-fixture.test/clip.webm");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("Control clip");
  await page
    .getByRole("button", { name: "Details for Control clip", exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.3);
}

test("the player opens on play/pause, so Space does what the hint says", async ({
  page,
}) => {
  await playClip(page);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(false);
});

test("the sleep timer counts down in one place and cancelling clears it everywhere", async ({
  page,
}) => {
  await playClip(page);
  await page.getByRole("button", { name: "Sleep timer", exact: true }).click();
  await page.getByRole("button", { name: "15 min", exact: true }).click();
  const badge = page.locator(".pc-badge");
  await expect(badge).toHaveText(/^1[45] min$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Sleep timer set" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Sleep timer/ }).click();
  await expect(page.getByText(/^Stops in /)).toBeVisible();
  await page.getByRole("button", { name: "Cancel timer" }).click();
  await expect(badge).toHaveCount(0);
  await expect(page.getByText("Playback will stop")).toHaveCount(0);
  // The confirmation is a hint that goes away by itself, never stale text.
  await expect(
    page.getByRole("status").filter({ hasText: "cancelled" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "cancelled" }),
  ).toHaveCount(0, {
    timeout: 8000,
  });
});

test("fullscreen takes the whole player, and Escape from fullscreen does not close it", async ({
  page,
}) => {
  await playClip(page);
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.className ?? ""),
    )
    .toContain("player-shell");
  // The browser asks the dialog to close when Escape is pressed; while fullscreen it must
  // only leave fullscreen.
  await page.evaluate(() =>
    document
      .querySelector("dialog.player-dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true })),
  );
  await expect(page.locator("video")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Close player" }),
  ).toBeVisible();
});

test("controls fade while playing and return with movement, and keep their place when paused", async ({
  page,
}) => {
  await playClip(page);
  const shell = page.locator(".player-shell");
  await page.mouse.move(300, 300);
  await expect(shell).toHaveClass(/ui-idle/, { timeout: 12000 });
  await page.mouse.move(340, 320);
  await expect(shell).not.toHaveClass(/ui-idle/);
});

test("the scrubber seeks and the time shows hours only when needed", async ({
  page,
}) => {
  await playClip(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Seek video" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.9);
  await expect(page.getByLabel("Playback time")).toContainText("/ 0:30");
});

test("controls stay while the pointer rests on them, and a press on hidden controls only wakes them", async ({
  page,
}) => {
  await playClip(page);
  const shell = page.locator(".player-shell");
  await page.getByRole("button", { name: "Pause", exact: true }).hover();
  await page.waitForTimeout(3600);
  await expect(shell).not.toHaveClass(/ui-idle/);
  await page.mouse.move(300, 300);
  await expect(shell).toHaveClass(/ui-idle/, { timeout: 5000 });
  expect(
    await page
      .locator(".player-stage")
      .evaluate((stage) => getComputedStyle(stage).cursor),
  ).toBe("none");
  // The first press brings the controls back; it does not also pause the picture.
  await page.mouse.click(300, 300);
  await expect(shell).not.toHaveClass(/ui-idle/);
  expect(
    await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
  ).toBe(false);
});

test("a picture that plays with no sound decoded says so, without blocking", async ({
  page,
}) => {
  // The fixture clip has no audio track, so after a few seconds no audio has been decoded.
  await playClip(page);
  const notice = page
    .getByRole("status")
    .filter({ hasText: "No sound is coming through" });
  await expect(notice).toBeVisible({ timeout: 10000 });
  await expect(notice).toContainText("AC-3");
  expect(
    await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
  ).toBe(false);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});
