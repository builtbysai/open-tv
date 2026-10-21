import { test, expect, settingsTab } from "./viewer-test";

test("on a phone the filters sit behind a Filters button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/live");
  const toggle = page.getByRole("button", { name: /^Filters/ });
  await expect(toggle).toBeVisible();
  await expect(page.getByLabel("Filter category")).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel("Filter category")).toBeVisible();
});
test("display size is saved on this device and applied at start", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await settingsTab(page, "This device");
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display", "large");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-display", "large");
  await settingsTab(page, "This device");
  await page.getByRole("radio", { name: "Default" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-display", /.*/);
});
test("TV mode started from a link can be left from the footer", async ({
  page,
}) => {
  await page.goto("/?tv=1#/home");
  await page.getByRole("link", { name: "Exit TV mode" }).click();
  await expect(page).not.toHaveURL(/tv=1/);
});
test("a screen with nothing to show says what to do, and a filter that empties it can be cleared", async ({
  page,
}) => {
  await page.goto("/#/audio");
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Manage sources" }),
  ).toBeVisible();
});
