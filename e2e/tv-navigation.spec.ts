import { test, expect } from "./viewer-test";
test.use({ viewport: { width: 1280, height: 720 } });
test("the TV searches with the system keyboard only, and Enter moves to the results", async ({
  page,
}) => {
  await page.goto("/?tv=1#/home");
  const browse = page.getByRole("button", { name: "Browse on this TV" });
  const search = page.getByRole("button", { name: "Search", exact: true });
  // The TV may open on its idle screen first.
  await browse.or(search).first().waitFor();
  if (await browse.isVisible()) await browse.click();
  await search.click();
  const field = page.getByRole("searchbox");
  await expect(field).toBeFocused();
  // No keyboard of the app's own: the field is a plain input the TV's keyboard types into.
  await expect(page.locator(".tv-keyboard")).toHaveCount(0);
  await expect(page.getByText(/type with the TV keyboard/)).toBeVisible();
  await field.pressSequentially("big buck");
  await field.press("Enter");
  await expect(field).not.toBeFocused();
  await expect(
    page.getByRole("button", { name: /Details for Big Buck Bunny/ }).first(),
  ).toBeVisible();
});
test("voice search from the TV app and a ?q= address land in search with results", async ({
  page,
}) => {
  await page.goto("/?tv=1&q=sintel#/home");
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page.getByRole("searchbox")).toHaveValue("sintel");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("opentv:search", { detail: { text: "big buck" } }),
    ),
  );
  await expect(page.getByRole("searchbox")).toHaveValue("big buck");
  await expect(
    page.getByRole("button", { name: /Details for Big Buck Bunny/ }).first(),
  ).toBeVisible();
});
test("search stays on phones and computers", async ({ page }) => {
  await page.goto("/#/search");
  await expect(page.getByRole("searchbox")).toBeVisible();
});
test("Down from the menu lands on the screen's first control, not where you were", async ({
  page,
}) => {
  await page.goto("/?tv=1#/movies");
  await expect(page.locator(".card-select").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const label = () =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute("aria-label") ||
        document.activeElement?.textContent ||
        "",
    );
  await page.locator(".app-header [aria-current=page]").focus();
  await page.keyboard.press("ArrowDown");
  const first = await label();
  await page.locator(".card-select").nth(3).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-header [aria-current=page]")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect.poll(label).toBe(first);
});
test("page down jumps a screen through a long grid", async ({ page }) => {
  await page.goto("/?tv=1#/live");
  await expect(page.locator(".card-select").first()).toBeVisible();
  const label0 = () =>
    page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") || "",
    );
  for (let i = 0; i < 10 && !/^Details for /.test(await label0()); i++)
    await page.keyboard.press("ArrowDown");
  const top = () =>
    page.evaluate(
      () => document.activeElement?.getBoundingClientRect().top ?? 0,
    );
  const label = () =>
    page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") || "",
    );
  const first = await label();
  await page.keyboard.press("PageDown");
  await expect.poll(label).not.toBe(first);
  expect(await top()).toBeGreaterThan(0);
});
