import { test, expect, settingsTab } from "./viewer-test";

test("This device keeps its own choices, applies them, and they survive a reload", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await settingsTab(page, "This device");
  await expect(
    page.getByRole("heading", { name: "This device" }),
  ).toBeVisible();
  await expect(page.getByText("Mouse and keyboard")).toBeVisible();
  await page.getByRole("radio", { name: "Minimal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("radio", { name: "30s" }).click();
  await page
    .getByRole("switch", { name: "Open TV controls for embedded servers" })
    .click();
  await page.reload();
  await settingsTab(page, "This device");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByRole("radio", { name: "30s" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("switch", { name: "Open TV controls for embedded servers" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: /Reset this device/ }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", /.+/);
});
