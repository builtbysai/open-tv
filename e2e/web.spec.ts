import { expect, test } from "@playwright/test";
import { BRIDGE, SILENT, seed } from "./helpers";

async function webPage(browser: import("@playwright/test").Browser, servers?: Parameters<typeof seed>[1]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await seed(context, servers);
  const page = await context.newPage();
  await page.goto("/");
  return { context, page };
}

test.describe("website", () => {
  test("browse, open a title, play in the browser and control it", async ({ browser }) => {
    const { page } = await webPage(browser);
    await expect(page.locator(".row h2").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "The Matrix" }).first().click();
    await expect(page.locator(".title h1")).toHaveText("The Matrix");
    await page.getByRole("button", { name: /^Play/ }).click();
    await expect(page).toHaveURL(/#\/w\/.*\/603/);
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${BRIDGE}/embed/movie/603`);
    await expect(page.locator(".watch-controls")).toBeVisible({ timeout: 20_000 });
    const frame = () => page.frames().find((f) => f.url().includes(":4181/embed/"))!;
    await expect.poll(() => frame().evaluate(() => !document.querySelector("video")!.paused)).toBe(true);
    await page.keyboard.press("k");
    await expect.poll(() => frame().evaluate(() => document.querySelector("video")!.paused)).toBe(true);
    await page.keyboard.press("k");
    await expect.poll(() => frame().evaluate(() => document.querySelector("video")!.paused)).toBe(false);
    await page.getByRole("button", { name: "Back" }).first().click();
    await expect(page.locator(".title h1")).toBeVisible();
  });

  test("a deep link to a watch page plays after one click", async ({ browser }) => {
    const { page } = await webPage(browser);
    await page.goto("/#/w/movies/movie/603");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${BRIDGE}/embed/movie/603`, { timeout: 15_000 });
  });

  test("search finds a title", async ({ browser }) => {
    const { page } = await webPage(browser);
    await page.getByLabel("Search").fill("matrix");
    await expect(page).toHaveURL(/#\/search\/matrix/);
    await expect(page.getByRole("link", { name: "The Matrix" }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("a server without the bridge still plays and says it cannot be controlled", async ({ browser }) => {
    const { page } = await webPage(browser, { servers: [{ id: "silent1", name: "Silent", base: SILENT }] });
    await page.goto("/#/w/movies/movie/603");
    await expect(page.locator("iframe.embed-frame")).toHaveAttribute("src", `${SILENT}/embed/movie/603`, { timeout: 15_000 });
    await expect(page.locator(".silent-note")).toBeVisible({ timeout: 15_000 });
  });

  test("without setup, home explains what to do", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Setup" }).first()).toBeVisible();
    await page.getByRole("link", { name: "Setup" }).first().click();
    await expect(page.getByPlaceholder("API key or read access token")).toBeVisible();
  });
});
