import { test, expect } from "./viewer-test";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const clip = readFileSync(new URL("./fixtures/clip.webm", import.meta.url));
async function serveClip(page: Page) {
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
}
export async function addClip(page: Page, title = "Remote clip") {
  const file = title.toLowerCase().replace(/\W+/g, "-");
  await serveClip(page);
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill(`https://video-fixture.test/${file}.webm`);
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.locator(".toast")).toBeVisible();
}

// Every visible control in the TV player can be reached from where focus starts, with
// the arrow keys alone: a remote without media keys has no other way to press them.
test("every visible TV player control is reachable with the D-pad", async ({
  page,
}) => {
  await addClip(page);
  await addClip(page, "Second clip");
  // The size a Google TV WebView lays the page out at.
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/?tv=1#/library");
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  const card = page.getByRole("button", {
    name: "Details for Remote clip",
    exact: true,
  });
  await card.first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Watch now", exact: true }).focus();
  await page.keyboard.press("Enter");
  const player = page.locator("dialog.player-dialog");
  await expect(player).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.2);
  const names: string[] = await player.evaluate((dialog) => {
    const items = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button,a[href],input,select,[tabindex="0"]',
      ),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        el.tabIndex >= 0 &&
        getComputedStyle(el).visibility === "visible" &&
        !el.closest("[hidden]")
      );
    });
    items.forEach((el, i) => (el.dataset.walk = String(i)));
    return items.map(
      (el) => el.getAttribute("aria-label") || el.textContent?.trim() || "?",
    );
  });
  expect(names.length).toBeGreaterThan(3);
  const start = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.walk ?? "",
  );
  expect(start).not.toBe("");
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      await page.evaluate(
        (walk) =>
          document.querySelector<HTMLElement>(`[data-walk="${walk}"]`)?.focus(),
        id,
      );
      await page.keyboard.press(key);
      const next = await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.dataset.walk ?? "",
      );
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const missing = names.filter((_, i) => !seen.has(String(i)));
  if (missing.length)
    console.log(
      await player.evaluate((d) =>
        [...d.querySelectorAll<HTMLElement>("[data-walk]")].map((e) => {
          const r = e.getBoundingClientRect();
          return `${e.dataset.walk} ${e.getAttribute("aria-label") || e.textContent?.trim()} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        }),
      ),
      "start",
      start,
    );
  expect(missing).toEqual([]);
  // Back in the player closes it, once.
  await page.keyboard.press("Escape");
  await expect(player).toBeHidden();
});

test("TV focus is predictable: the menu moves one step at a time and a screen opens at its first control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/?tv=1");
  await expect(
    page.getByRole("button", { name: "Browse on this TV" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("button", { name: "Home" })).toBeFocused();
  const order = ["Live TV", "Movies & Shows", "Listen", "My Library"];
  for (const name of order) {
    await page.keyboard.press("ArrowRight");
    await expect(nav.getByRole("button", { name, exact: true })).toBeFocused();
  }
  for (const name of [...order].reverse().slice(1)) {
    await page.keyboard.press("ArrowLeft");
    await expect(nav.getByRole("button", { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press("ArrowLeft");
  await expect(nav.getByRole("button", { name: "Home" })).toBeFocused();
  // Into Home, deep into it, back to the menu, and in again: the same first control.
  await page.keyboard.press("ArrowDown");
  const first = await page.evaluate(
    () =>
      document.activeElement?.getAttribute("aria-label") ||
      document.activeElement?.textContent,
  );
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(nav.getByRole("button", { name: "Home" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ||
          document.activeElement?.textContent,
      ),
    )
    .toBe(first);
});

test("notices leave by themselves and never take focus", async ({ page }) => {
  await addClip(page, "Notice clip");
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button")).toHaveAttribute("tabindex", "-1");
  await expect(toast).toHaveCount(0, { timeout: 10000 });
});
