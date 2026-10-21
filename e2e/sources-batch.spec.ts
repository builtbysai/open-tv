import { test, expect } from "./viewer-test";
test("bundled news channels are present", async ({ page }) => {
  await page.goto("/#/search");
  await page.getByRole("searchbox").fill("Sky News Arabia");
  await expect(
    page.getByRole("button", { name: /Details for Sky News Arabia/ }).first(),
  ).toBeVisible();
});
test("SomaFM stations appear in Audio", async ({ page }) => {
  await page.route("https://somafm.com/channels.json", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        channels: [
          {
            id: "groovesalad",
            title: "Groove Salad",
            genre: "ambient",
            description: "Chilled beats.",
            playlists: [
              {
                url: "https://api.somafm.com/groovesalad.pls",
                format: "mp3",
                quality: "highest",
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("https://api.somafm.com/groovesalad.pls", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      body: "[playlist]\nFile1=https://ice1.somafm.com/groovesalad-128-mp3\n",
    }),
  );
  await page.goto("/#/audio");
  await expect(
    page.getByRole("button", { name: "Details for SomaFM Groove Salad" }),
  ).toBeVisible();
});
test("a NASA video becomes playable when opened", async ({ page }) => {
  await page.route("https://images-api.nasa.gov/search**", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        collection: {
          items: [
            {
              data: [
                {
                  nasa_id: "KSC-1",
                  title: "Launch Fixture",
                  date_created: "1969-07-16T00:00:00Z",
                },
              ],
              links: [],
            },
          ],
        },
      },
    }),
  );
  await page.route("https://images-api.nasa.gov/asset/KSC-1", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        collection: {
          items: [
            {
              href: "http://images-assets.nasa.gov/video/KSC-1/KSC-1~medium.mp4",
            },
          ],
        },
      },
    }),
  );
  await page.goto("/#/search");
  await page.getByRole("searchbox").fill("Launch Fixture");
  await page
    .getByRole("button", { name: "Details for Launch Fixture" })
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Watch now" }),
  ).toBeVisible();
});
