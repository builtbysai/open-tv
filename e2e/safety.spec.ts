import { test, expect, settingsTab } from "./viewer-test";
test("18+ content is hidden on a first visit, and consent is asked once", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await expect(page.locator(".private-banner")).toHaveCount(0);
  await settingsTab(page, "Privacy");
  const age = page.getByLabel(
    "I am 18+ and permitted to view adult content in my region.",
  );
  await expect(age).toBeVisible();
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  await expect(
    page.getByText("Confirm that you are 18 or older"),
  ).toBeVisible();
  await expect(page.locator(".private-banner")).toHaveCount(0);
  await age.check();
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  await expect(page.locator(".private-banner")).toBeVisible();
  await page
    .locator(".private-banner")
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(page.locator(".private-banner")).toHaveCount(0);
  await settingsTab(page, "Privacy");
  await expect(age).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  await expect(page.locator(".private-banner")).toBeVisible();
  // It stays on after a reload, until it is hidden.
  await page.reload();
  await expect(page.locator(".private-banner")).toBeVisible();
  await page
    .locator(".private-banner")
    .getByRole("button", { name: "Hide" })
    .click();
  await page.reload();
  await expect(page.locator(".private-banner")).toHaveCount(0);
});
test("copyright reporting is reachable without age admission and private notice fields are never autosaved or publicly prefilled", async ({
  page,
}) => {
  await page.goto("/#/legal");
  await expect(
    page.getByRole("heading", { name: "Content reports", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "has not yet published" }),
  ).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "no public report form" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy report details" }),
  ).toBeVisible();
  const fields = {
    "Your name": "Private Owner",
    "Contact email": "private-owner@example.test",
    "Postal contact address": "Private Postal Location",
    "Copyrighted work and ownership": "My owned film",
    "Exact Open TV listing or location": "ot-testlisting",
    "Electronic signature": "Private Owner",
  };
  for (const [label, value] of Object.entries(fields))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel(
      "I have a good-faith belief that the use is not authorized by the copyright owner, its agent, or the law.",
      { exact: true },
    )
    .check();
  await page
    .getByLabel(
      "The information is accurate and, under penalty of perjury, I am authorized to act for the owner of the exclusive right.",
      { exact: true },
    )
    .check();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download private notice", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    "open-tv-takedown-notice.json",
  );
  await expect(page.getByRole("status")).toContainText(
    "has not been submitted",
  );
  const href = await page
    .getByRole("link", { name: "Open GitHub listing report", exact: false })
    .getAttribute("href");
  expect(href).not.toMatch(/Private|owner|example.test|Postal/);
  const stores = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stores).not.toMatch(/private-owner|Private Postal|Private Owner/);
  await page.reload();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue("");
});
test("the TV opens on its idle screen and browses from there, without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/?tv=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Browse on this TV" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
