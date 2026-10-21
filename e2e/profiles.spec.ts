import { test, expect } from "./viewer-test";
test("profiles keep their own saved titles and the picker switches between them", async ({
  page,
}) => {
  await page.goto("/#/home");
  const save = page.getByRole("button", {
    name: "Save Big Buck Bunny",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Switch profile, Main", exact: true })
    .click();
  await page.getByRole("button", { name: "Add profile", exact: true }).click();
  await page.getByLabel("Profile name").fill("Kids");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Switch profile, Kids", exact: true }),
  ).toBeVisible();
  await save.first().click({ force: true });
  await expect(
    page
      .getByRole("button", { name: "Remove Big Buck Bunny", exact: true })
      .first(),
  ).toBeAttached();
  await page
    .getByRole("button", { name: "Switch profile, Kids", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Who’s watching?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Switch profile, Main", exact: true }),
  ).toBeVisible();
  await expect(save.first()).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Remove Big Buck Bunny", exact: true }),
  ).toHaveCount(0);
});
test("profiles can be renamed and deleted from settings", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "Profiles & data", exact: true }).click();
  await page.getByLabel("New profile").fill("Guest");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const name = page.getByLabel("Name for Guest");
  await name.fill("Alex");
  await name.blur();
  await expect(page.getByLabel("Name for Alex")).toBeVisible();
  await page.getByRole("button", { name: "Delete Alex", exact: true }).click();
  await page.getByRole("button", { name: "Delete Alex?", exact: true }).click();
  await expect(page.getByLabel("Name for Alex")).toHaveCount(0);
});
