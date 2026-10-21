import { test, expect } from "./viewer-test";
test("restores region, language, guide mode and library tab on refresh", async ({
  page,
}) => {
  await page.goto("/#/live");
  await expect(page.locator(".content-card").first()).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filter language", exact: true })
    .selectOption({ label: "English" });
  await page
    .getByRole("combobox", { name: "Filter country", exact: true })
    .selectOption({ label: "United Kingdom" });
  await page.getByRole("button", { name: "TV guide", exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Filter language", exact: true }),
  ).toHaveValue("English");
  await expect(
    page.getByRole("combobox", { name: "Filter country", exact: true }),
  ).toHaveValue("United Kingdom");
  await expect(
    page.getByRole("region", { name: "TV schedule", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "My Library", exact: true })
    .click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "History", exact: true }),
  ).toHaveClass("active");
});
test("restores a general form draft without its media or credential URLs", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("An unfinished entry");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://example.com/film.mp4?token=secret");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Notes worth keeping");
  await form
    .getByRole("textbox", { name: "Genres (comma separated)", exact: true })
    .fill("Drama, Independent");
  await form
    .getByRole("textbox", { name: "Languages (comma separated)", exact: true })
    .fill("French");
  await form
    .getByRole("spinbutton", { name: "Release year", exact: true })
    .fill("2024");
  await page.waitForTimeout(400);
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:user:v2")),
  ).not.toContain("secret");
  await page.reload();
  await expect(
    form.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("An unfinished entry");
  await expect(
    form.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue("Notes worth keeping");
  await expect(
    form.getByRole("textbox", {
      name: "Genres (comma separated)",
      exact: true,
    }),
  ).toHaveValue("Drama, Independent");
  await expect(
    form.getByRole("textbox", {
      name: "Languages (comma separated)",
      exact: true,
    }),
  ).toHaveValue("French");
  await expect(
    form.getByRole("spinbutton", { name: "Release year", exact: true }),
  ).toHaveValue("2024");
  await expect(
    form.getByRole("textbox", { name: "Media URL", exact: true }),
  ).toHaveValue("");
});
test("waits for delayed catalogs before restoring an expanded grid and scroll", async ({
  page,
}) => {
  await page.goto("/#/live");
  await expect(page.locator(".content-grid .content-card")).toHaveCount(72);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".content-grid .content-card")).toHaveCount(144);
  await page.locator("#main").evaluate((element) => (element.scrollTop = 1800));
  await expect
    .poll(() => page.locator("#main").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1700);
  await page.waitForTimeout(500);
  // Force a delayed cold cache read: storage restoration must not clamp the saved position to zero.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("opentv-catalog");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  await page.route("**/extension.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fallback();
  });
  await page.reload();
  await expect(page.locator(".content-grid .content-card")).toHaveCount(144);
  await expect
    .poll(() => page.locator("#main").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1700);
});
