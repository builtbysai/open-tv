import { test, expect } from "./viewer-test";

test("shelf paging works with reduced motion and View all clears previous browse filters", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/live");
  await page
    .getByRole("combobox", { name: "Filter category", exact: true })
    .selectOption("News");
  await page
    .getByRole("combobox", { name: "Filter language", exact: true })
    .selectOption("English");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  const shelf = page.getByRole("region", { name: "Live TV", exact: true });
  const previous = shelf.getByRole("button", {
    name: "Previous Live TV",
    exact: true,
  });
  await expect(previous).toBeDisabled();
  await shelf
    .getByRole("button", { name: "Next Live TV", exact: true })
    .click();
  await expect
    .poll(() =>
      shelf.locator(".content-rail").evaluate((element) => element.scrollLeft),
    )
    .toBeGreaterThan(100);
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(previous).toBeDisabled();
  await shelf
    .getByRole("button", { name: "View all Live TV", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/live$/);
  await expect(
    page.getByRole("combobox", { name: "Filter category", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Filter language", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toHaveCount(0);
});

test("title details disclose attribution and video checks on request and restore focus", async ({
  page,
}) => {
  await page.goto("/#/movies");
  const title = page.getByRole("button", {
    name: "Details for Sintel",
    exact: true,
  });
  await title.click();
  const detail = page.getByRole("dialog", { name: "Sintel", exact: true });
  await expect(
    detail.getByRole("button", { name: "Watch now", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Check video", exact: true }),
  ).toHaveCount(0);
  const source = detail.getByRole("button", {
    name: "Source & playback",
    exact: true,
  });
  await source.click();
  await expect(source).toHaveAttribute("aria-expanded", "true");
  await expect(
    detail.getByText("Source: Blender Open Movies", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Check video", exact: true }),
  ).toBeVisible();
  await source.click();
  await expect(source).toHaveAttribute("aria-expanded", "false");
  await expect(
    detail.getByRole("button", { name: "Check video", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await expect(title).toBeFocused();
});

test("mobile library collection controls and settings tabs stay reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/library");
  await expect(
    page.getByRole("combobox", { name: "Your collections", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "New collection", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Export personal media", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export personal media", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await page.getByRole("tab", { name: "Privacy", exact: true }).click();
  const privacy = page.getByLabel(
    "I am 18+ and permitted to view adult content in my region.",
    { exact: true },
  );
  await expect(privacy).toBeInViewport();
  expect(
    await page
      .locator(".main-content")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
});
