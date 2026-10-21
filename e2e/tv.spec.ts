import { test, expect, settingsTab } from "./viewer-test";
import { readFile } from "node:fs/promises";
import path from "node:path";
test("TV D-pad moves through navigation and rails, contains dialog focus and exits Back without loops", async ({
  page,
}) => {
  await page.goto("/?tv=1");
  // The TV opens on its idle screen; the remote can still browse from there.
  await expect(
    page.getByRole("button", { name: "Browse on this TV" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  await expect(
    nav.getByRole("button", { name: "Home", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(
    nav.getByRole("button", { name: "Home", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    nav.getByRole("button", { name: "Live TV", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/live$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/home$/);
  const first = page
    .getByRole("button", { name: "Details for Big Buck Bunny", exact: true })
    .first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page
      .getByRole("button", { name: "Details for Sintel", exact: true })
      .first(),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Sintel", exact: true }),
  ).toBeVisible();
  for (const key of [
    "ArrowDown",
    "ArrowRight",
    "ArrowDown",
    "ArrowLeft",
    "ArrowUp",
  ]) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("dialog[open]"),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    nav.getByRole("button", { name: "Home", exact: true }),
  ).toBeFocused();
  // Back at Home returns to the idle screen; Back there is left to the TV (exit).
  const back = () =>
    page.evaluate(
      () =>
        !window.dispatchEvent(new Event("opentv:back", { cancelable: true })),
    );
  expect(await back()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Browse on this TV" }),
  ).toBeVisible();
  expect(await back()).toBe(false);
});
test("TV player handles OK, media keys, bounded seeking and Back with real HLS playback", async ({
  page,
}) => {
  const root = path.resolve("e2e/fixtures/hls");
  await page.route("https://tv-hls-fixture.test/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({
      body: await readFile(path.join(root, name)),
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
  // Media is added on a phone or computer; the TV has no text entry.
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Remote HLS fixture");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://tv-hls-fixture.test/master.m3u8");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.locator(".toast")).toBeVisible();
  await page.goto("/?tv=1#/library");
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Details for Remote HLS fixture",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Video: play or pause", exact: true }),
  ).toBeFocused();
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.currentTime))
    .toBeGreaterThan(0.2);
  expect(await page.locator("video").evaluate((v) => v.controls)).toBe(false);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.paused))
    .toBe(true);
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "MediaPlay",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.paused))
    .toBe(false);
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "MediaPause",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.currentTime))
    .toBeLessThan(0.1);
  await page.keyboard.press("ArrowDown");
  expect(
    await page.evaluate(
      () =>
        !!document.activeElement?.closest(
          ".tv-transport,.player-tools,.player-bar",
        ),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("video")).toHaveCount(0);
});
test("TV settings hold only what a remote can use; Back steps out one level at a time; leaving the app keeps 18+ as it was", async ({
  page,
}) => {
  await page.goto("/?tv=1#/settings");
  // Sources can be switched on and off with the remote; adding playlists, servers,
  // accounts and profiles happens on the phone.
  await expect(
    page.getByRole("tab", { name: "Profiles & data", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/happens on your phone/)).toBeVisible();
  await expect(
    page.locator("#settings-sources .source-row").first(),
  ).toBeVisible();
  await expect(
    page.locator(
      '[role="tabpanel"]:not([hidden]) input[type="url"], [role="tabpanel"]:not([hidden]) textarea',
    ),
  ).toHaveCount(0);
  const back = () =>
    page.evaluate(
      () =>
        !window.dispatchEvent(new Event("opentv:back", { cancelable: true })),
    );
  await page.getByRole("tab", { name: "Privacy", exact: true }).focus();
  expect(await back()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Settings and sources", exact: true }),
  ).toBeFocused();
  expect(await back()).toBe(true);
  await expect(page).toHaveURL(/#\/home$/);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Home", exact: true }),
  ).toBeFocused();
  expect(await back()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Browse on this TV" }),
  ).toBeVisible();
  expect(await back()).toBe(false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await settingsTab(page, "Privacy");
  const age = page.getByLabel(
    "I am 18+ and permitted to view adult content in my region.",
  );
  await age.focus();
  await page.keyboard.press("Enter");
  await expect(age).toBeChecked();
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  await expect(page.locator(".private-banner")).toBeVisible();
  // Leaving the app keeps the choice (the Android app hides its window while away).
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:suspend")));
  await expect(page.locator(".private-banner")).toBeVisible();
});
