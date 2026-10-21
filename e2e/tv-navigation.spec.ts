import { test, expect } from "./viewer-test";
test.use({ viewport: { width: 1280, height: 720 } });
test("the TV takes no typing: no search screen, no search button, no keyboard of its own", async ({
  page,
}) => {
  await page.goto("/?tv=1#/search");
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".tv-keyboard")).toHaveCount(0);
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
