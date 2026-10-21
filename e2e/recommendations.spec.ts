import { test, expect, enablePrivateViewing } from "./viewer-test";
test("Home recommendations are local, actionable, restored and still there while 18+ is shown", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "For you",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save Big Buck Bunny", exact: true })
    .first()
    .click();
  const rail = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "For you",
      exact: true,
    }),
  });
  await expect(rail).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "Details for Sintel", exact: true }),
  ).toBeVisible();
  await expect(
    rail.getByRole("button", {
      name: "Details for Big Buck Bunny",
      exact: true,
    }),
  ).toHaveCount(0);
  await rail
    .getByRole("button", { name: "Details for Sintel", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Sintel", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page.reload();
  await expect(rail).toBeVisible();
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await enablePrivateViewing(page);
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(rail).toBeVisible();
});
