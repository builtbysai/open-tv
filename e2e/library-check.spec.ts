import { test, expect } from "./viewer-test";
const movie = (id: number, title: string) => ({
  id,
  title,
  release_date: "2024-01-01",
  vote_average: 7.5,
  genre_ids: [18],
  overview: "Overview.",
});
test("titles found on your servers by TMDB id show as yours and play", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route("https://api.themoviedb.org/**", (route) =>
    route.fulfill({
      json: {
        results: route.request().url().includes("/tv/")
          ? []
          : [movie(11, "Server Film"), movie(12, "Absent Film")],
      },
    }),
  );
  // The first server has only the first film; the second has both.
  await page.route("https://one.example/embed/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      status: route.request().url().endsWith("/11") ? 200 : 404,
      headers: { "access-control-allow-origin": "*" },
      body: "",
    });
  });
  await page.route("https://two.example/embed/**", (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/11") ? 200 : 404,
      headers: { "access-control-allow-origin": "*" },
      body: "",
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("opentv:tmdb-key:v1", "abc123");
    localStorage.setItem(
      "opentv:servers:v1",
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: "ot-one",
            name: "One",
            base: "https://one.example",
            classification: "general",
            enabled: true,
          },
          {
            id: "ot-two",
            name: "Two",
            base: "https://two.example",
            classification: "general",
            enabled: true,
          },
        ],
      }),
    );
  });
  await page.goto("/#/home");
  const shelf = page.getByRole("region", { name: "Trending this week" });
  await expect(
    shelf.getByRole("button", { name: "Details for Server Film" }),
  ).toBeVisible();
  expect(asked.some((url) => url.endsWith("/embed/movie/11"))).toBe(true);
  // An absent title opens as not yours.
  await shelf.getByRole("button", { name: /Absent Film/ }).click();
  await expect(
    page.getByRole("dialog").getByText("Not in your library"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await shelf.getByRole("button", { name: "Details for Server Film" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /Watch|Play/ })
      .first(),
  ).toBeVisible();
});
