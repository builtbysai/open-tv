import { test, expect } from "./viewer-test";
test("search ranks titles, forgives typos and filters by type", async ({
  page,
}) => {
  await page.goto("/#/search");
  await expect(page.getByRole("group", { name: "Genres" })).toBeVisible();
  await page.getByLabel("Search catalog").fill("big buk bunny");
  await expect(
    page.getByRole("button", {
      name: "Details for Big Buck Bunny",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Result type" })
      .getByRole("button", { name: /^Movies/ }),
  ).toBeVisible();
  await page.getByLabel("Search catalog").fill("news channels");
  await expect(
    page
      .getByRole("group", { name: "Result type" })
      .getByRole("button", { name: /^Movies/ }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: "Result type" })
      .getByRole("button", { name: /^Live TV/ }),
  ).toBeVisible();
  await page.getByLabel("Search catalog").fill("zzzzqqxx");
  await expect(page.getByText("No results")).toBeVisible();
});
test("search shows TMDB titles that are not in the library", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("opentv:tmdb-key:v1", "abc123"),
  );
  await page.route("https://api.themoviedb.org/**", (route) => {
    const url = route.request().url();
    route.fulfill({
      json: {
        results: url.includes("/search/movie")
          ? [
              {
                id: 9,
                title: "Zorblax Returns",
                release_date: "2024-01-01",
                vote_average: 7,
              },
            ]
          : [],
      },
    });
  });
  await page.goto("/#/search");
  await page.getByLabel("Search catalog").fill("zorblax");
  const section = page.getByRole("region", { name: "Not in your library" });
  await expect(
    section.getByRole("button", { name: "Details for Zorblax Returns" }),
  ).toBeVisible();
  // A film only TMDB knows still gets the Movies filter.
  const types = page.getByRole("group", { name: "Result type" });
  await types.getByRole("button", { name: /^Movies/ }).click();
  await expect(
    section.getByRole("button", { name: "Details for Zorblax Returns" }),
  ).toBeVisible();
});
