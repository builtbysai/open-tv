import { test, expect } from "./viewer-test";
const result = (id: number, title: string, year: string, tv = false) => ({
  id,
  [tv ? "name" : "title"]: title,
  [tv ? "first_air_date" : "release_date"]: year,
  vote_average: 7.4,
  genre_ids: [18],
  overview: "Overview.",
});
test.beforeEach(async ({ page }) => {
  await page.route("https://api.themoviedb.org/**", (route) =>
    route.fulfill({
      json: {
        results: route.request().url().includes("/tv/")
          ? [result(2, "Some Series", "2023-01-01", true)]
          : [
              result(1, "Big Buck Bunny", "2008-04-10"),
              result(3, "Missing Film", "2024-02-02"),
            ],
      },
    }),
  );
});
test("matches popular titles to the library and marks the rest", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.getByLabel("API key or read access token").fill("abc123");
  await page
    .locator("#settings-tmdb")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:tmdb-key:v1")),
  ).toBeNull();
  await page.goto("/#/home");
  const trending = page.getByRole("region", { name: "Trending this week" });
  await expect(
    trending.getByRole("button", { name: "Details for Big Buck Bunny" }),
  ).toBeVisible();
  await expect(trending.locator(".unowned").first()).toBeVisible();
  // Each title shows in one discovery shelf only, and nothing was played here yet.
  await expect(
    page
      .getByRole("region", { name: "Popular movies" })
      .getByRole("button", { name: /Big Buck Bunny|Missing Film/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Popular on your servers" }),
  ).toHaveCount(0);
  await trending.getByRole("button", { name: /Missing Film/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Not in your library")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Watch/ })).toHaveCount(0);
});
test("remembers the key only when asked and reports rejected keys", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.getByLabel("API key or read access token").fill("abc123");
  await page
    .locator("#settings-tmdb")
    .getByLabel("Remember on this device")
    .check();
  await page
    .locator("#settings-tmdb")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:tmdb-key:v1")),
  ).toBe("abc123");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:tmdb-key:v1")),
  ).toBeNull();
  await page.unroute("https://api.themoviedb.org/**");
  await page.route("https://api.themoviedb.org/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.getByLabel("API key or read access token").fill("bad");
  await page
    .locator("#settings-tmdb")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByText("TMDB rejected this key")).toBeVisible();
});
test("free archive films fill Home until a TMDB key replaces them with trending titles", async ({
  page,
}) => {
  await page.route("https://image.tmdb.org/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    }),
  );
  await page.route("https://api.themoviedb.org/**", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            id: 77,
            title: "Zorblax Returns",
            release_date: "2024-05-01",
            backdrop_path: "/z.jpg",
            poster_path: "/zp.jpg",
            vote_average: 8.1,
            genre_ids: [878],
            overview: "A trending fixture.",
          },
        ],
      },
    }),
  );
  await page.goto("/#/home");
  await expect(page.getByRole("region", { name: "Films" })).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem("opentv:tmdb-key:v1", "abc123"),
  );
  await page.reload();
  await expect(page.locator(".hero h1")).toHaveText("Zorblax Returns");
  await expect(page.locator(".hero-category")).toContainText(
    "Not in your library",
  );
  await expect(
    page.getByRole("button", { name: "Search your sources" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Trending this week" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Films" })).toHaveCount(0);
});
