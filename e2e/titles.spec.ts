import { test, expect, settingsTab } from "./viewer-test";
const result = (id: number, title: string, genres = [18]) => ({
  id,
  title,
  release_date: "2024-03-01",
  vote_average: 7.1,
  genre_ids: genres,
  overview: "Overview.",
});
test("a missing title shows where to watch and can be wished for", async ({
  page,
}) => {
  await page.route("https://api.themoviedb.org/**", (route) => {
    const url = route.request().url();
    route.fulfill({
      json: url.includes("watch/providers")
        ? {
            results: {
              US: {
                link: "https://www.themoviedb.org/movie/9/watch?locale=US",
                flatrate: [{ provider_name: "Streamly" }],
                rent: [{ provider_name: "RentIt" }],
              },
            },
          }
        : { results: url.includes("/tv/") ? [] : [result(9, "Wished Film")] },
    });
  });
  await page.addInitScript(() =>
    localStorage.setItem("opentv:tmdb-key:v1", "abc123"),
  );
  await page.goto("/#/home");
  await page
    .getByRole("region", { name: "Trending this week" })
    .getByRole("button", { name: /Wished Film/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Streamly")).toBeVisible();
  await expect(dialog.getByText("RentIt")).toBeVisible();
  await expect(
    dialog.getByText("Availability data from JustWatch."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Add to wishlist" }).click();
  await expect(
    dialog.getByRole("button", { name: "On your wishlist" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "My Library" })
    .click();
  await page.getByRole("button", { name: "Wishlist", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Wished Film", exact: true }),
  ).toBeVisible();
});
test("a Kids profile hides Settings, 18+ and titles not made for children", async ({
  page,
}) => {
  await page.route("https://api.themoviedb.org/**", (route) =>
    route.fulfill({
      json: {
        results: route.request().url().includes("/tv/")
          ? []
          : [
              result(21, "Cartoon Fun", [16]),
              result(22, "Grim Thriller", [53]),
            ],
      },
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("opentv:tmdb-key:v1", "abc123"),
  );
  await page.goto("/#/settings");
  await settingsTab(page, "Profiles & data");
  await page.getByLabel("New profile").fill("Junior");
  await page.getByLabel("Kids profile").check();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Switch profile/ }).click();
  await page.getByRole("button", { name: /Junior/ }).click();
  await expect(
    page.getByRole("button", { name: "Settings and sources" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Cartoon Fun/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Grim Thriller/ })).toHaveCount(
    0,
  );
});
test("a Kids profile's empty screens point to the main profile, not Settings", async ({
  page,
}) => {
  // No channel lists at all, so Live TV is empty.
  await page.route("**/extension.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/#/settings");
  await settingsTab(page, "Profiles & data");
  await page.getByLabel("New profile").fill("Junior");
  await page.getByLabel("Kids profile").check();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Switch profile/ }).click();
  await page.getByRole("button", { name: /Junior/ }).click();
  await page.goto("/#/live");
  await expect(
    page.getByText("Ask a grown-up to add sources from the main profile."),
  ).toBeVisible();
  await expect(page.getByText(/in Settings/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Manage sources" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".app-footer").getByRole("button", { name: "Settings" }),
  ).toHaveCount(0);
});
test("an Internet Archive title becomes playable when opened", async ({
  page,
}) => {
  await page.route("https://archive.org/advancedsearch.php**", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        response: {
          docs: [
            {
              identifier: "fixture-film",
              title: "Archive Fixture Film",
              year: 1931,
              licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
            },
          ],
        },
      },
    }),
  );
  await page.route("https://archive.org/metadata/fixture-film", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        files: [{ name: "film.mp4", format: "h.264", size: "1000000" }],
        metadata: { identifier: "fixture-film" },
      },
    }),
  );
  await page.goto("/#/movies");
  await page
    .getByRole("button", { name: "Details for Archive Fixture Film" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Watch now" }),
  ).toBeVisible();
});
