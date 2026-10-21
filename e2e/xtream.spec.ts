import { test, expect, type Page, settingsTab } from "./viewer-test";
import { readFile } from "node:fs/promises";
import path from "node:path";
const server = "https://series-fixture.test";
const seriesTitle = "Field notes fixture";
const episodes = {
  info: { genre: "Documentary" },
  episodes: {
    "0": [
      {
        id: 1,
        episode_num: 1,
        season: 0,
        title: "Behind the scenes",
        container_extension: "m3u8",
      },
    ],
    "1": [
      {
        id: 11,
        episode_num: 1,
        season: 1,
        title: "First light",
        container_extension: "m3u8",
        info: {
          plot: "A quiet journey through an open landscape. A synthetic test episode.",
          duration_secs: 1440,
        },
      },
      {
        id: 12,
        episode_num: 2,
        season: 1,
        title: "The long way home",
        container_extension: "m3u8",
        info: { duration_secs: 1320 },
      },
    ],
    "2": [
      {
        id: 21,
        episode_num: 1,
        season: 2,
        title: "A new horizon",
        container_extension: "m3u8",
      },
    ],
  },
};
async function signIn(page: Page, remember = false) {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect account", exact: true }),
  });
  await form.getByRole("textbox", { name: "Server", exact: true }).fill(server);
  await form
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("fixture-user");
  await form.getByLabel("Password", { exact: true }).fill("fixture-secret");
  await form
    .getByRole("combobox", { name: "Catalog", exact: true })
    .selectOption("series");
  await form.getByLabel("Remember on this device").setChecked(remember);
  await form
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
}
async function findSeries(page: Page) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill(seriesTitle);
  await page
    .getByRole("button", { name: `Details for ${seriesTitle}`, exact: true })
    .click();
}
async function storageSnapshot(page: Page) {
  return page.evaluate(async () => {
    const stores: unknown[] = [];
    for (const database of await indexedDB.databases()) {
      if (!database.name) continue;
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(database.name!);
        request.onsuccess = () => resolve(request.result);
      });
      for (const name of db.objectStoreNames) {
        stores.push(
          await new Promise((resolve) => {
            const request = db.transaction(name).objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
          }),
        );
      }
      db.close();
    }
    return JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      stores,
    });
  });
}
test("series load on demand, retry safely, navigate seasons, play episodes and disconnect without storing account data", async ({
  page,
}) => {
  let infoCalls = 0;
  await page.route(`${server}/player_api.php**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "get_series_info") infoCalls++;
    await route.fulfill({
      status: action === "get_series_info" && infoCalls === 1 ? 503 : 200,
      headers: { "access-control-allow-origin": "*" },
      json:
        action === "get_series_categories"
          ? [{ category_id: "1", category_name: "Documentary" }]
          : action === "get_series"
            ? [
                {
                  series_id: 42,
                  name: seriesTitle,
                  category_id: "1",
                  plot: "Stories from the places between. Synthetic catalog for browser validation.",
                },
              ]
            : episodes,
    });
  });
  const root = path.resolve("e2e/fixtures/hls");
  await page.route(`${server}/series/**`, async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    const file = /^\d+\.m3u8$/.test(name) ? "master.m3u8" : name;
    await route.fulfill({
      body: await readFile(path.join(root, file)),
      headers: {
        "access-control-allow-origin": "*",
        "content-type": file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : file.endsWith(".vtt")
            ? "text/vtt"
            : "video/mp2t",
      },
    });
  });
  await page.goto("/#/settings");
  await signIn(page);
  await expect(
    page.getByText("1 entry · connected", { exact: true }),
  ).toBeVisible();
  expect(infoCalls).toBe(0);
  await expect(
    page.locator("#account-connection input[name=password]"),
  ).toHaveValue("");
  await findSeries(page);
  await expect(
    page.getByRole("button", { name: "Watch now", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Retry episodes", exact: true })
    .click();
  await expect(
    page.getByText("4 episodes · 3 seasons", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Choose season", exact: true })
    .selectOption("0");
  await expect(
    page.getByRole("button", {
      name: "Play S0 E1: Behind the scenes",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Choose season", exact: true })
    .selectOption("1");
  await page
    .getByRole("button", {
      name: "Details for S1 E1: First light",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "First light", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: seriesTitle, exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Choose season", exact: true }),
  ).toBeVisible();
  expect(infoCalls).toBe(2);
  await page
    .getByRole("button", { name: "Play S1 E1: First light", exact: true })
    .click();
  await expect
    .poll(() => page.locator("video").evaluate((video) => video.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.2);
  await page.locator("video").evaluate((video) => {
    video.pause();
    video.dispatchEvent(new Event("ended"));
  });
  await expect(page.locator(".player-bar h2")).toHaveText("The long way home");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".player-bar h2")).toHaveText("A new horizon");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".player-bar h2")).toHaveText("A new horizon");
  await page.getByRole("button", { name: "Close player", exact: true }).click();
  const persisted = await storageSnapshot(page);
  expect(persisted).not.toContain("fixture-secret");
  expect(persisted).not.toContain(server);
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  const row = page.locator(".source-row").filter({
    has: page.getByRole("heading", {
      name: "Connected provider · series",
      exact: true,
    }),
  });
  await row.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    row.getByText("Disconnected · sign in again to reconnect", { exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Sign in again", exact: true }).click();
  await expect(
    page.locator("#account-connection input[name=server]"),
  ).toBeFocused();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill(seriesTitle);
  await expect(
    page.getByRole("button", {
      name: `Details for ${seriesTitle}`,
      exact: true,
    }),
  ).toHaveCount(0);
});
test("accounts connect in normal viewing, and hiding 18+ content leaves them connected", async ({
  page,
}) => {
  await page.route(`${server}/player_api.php**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    await route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json:
        action === "get_series_categories"
          ? []
          : action === "get_series"
            ? [
                { series_id: 42, name: seriesTitle },
                { series_id: 43, name: "Explicit xxx night" },
              ]
            : episodes,
    });
  });
  await page.goto("/#/settings");
  await signIn(page);
  await expect(
    page.getByText("2 entries · connected", { exact: true }),
  ).toBeVisible();
  await findSeries(page);
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page.getByRole("searchbox").fill("Explicit xxx night");
  await expect(
    page.getByRole("button", {
      name: "Details for Explicit xxx night",
      exact: true,
    }),
  ).toHaveCount(0);
  const persisted = await storageSnapshot(page);
  expect(persisted).not.toContain("fixture-secret");
  expect(persisted).not.toContain(server);
});
test("a remembered account reconnects after a reload and can be removed", async ({
  page,
}) => {
  await page.route(`${server}/player_api.php**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    await route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json:
        action === "get_series_categories"
          ? []
          : action === "get_series"
            ? [{ series_id: 42, name: seriesTitle }]
            : episodes,
    });
  });
  await page.goto("/#/settings");
  await signIn(page, true);
  await expect(
    page.getByText("1 entry · connected", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await settingsTab(page, "Sources");
  await expect(
    page.getByText("1 entry · connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("list", { name: "Saved accounts" })
    .getByRole("button", { name: "Remove" })
    .click();
  await page.reload();
  await settingsTab(page, "Sources");
  await expect(page.getByText("1 entry · connected")).toHaveCount(0);
});
