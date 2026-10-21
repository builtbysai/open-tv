import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";
// Public directories the app queries on its own are answered with empty lists so the
// tests do not depend on the network.
// Tests start as a returning visitor. Set `freshVisit` to see the first-run welcome.
export const test = base.extend<{ freshVisit: boolean }>({
  freshVisit: [false, { option: true }],
  page: async ({ page, freshVisit }, use) => {
    if (!freshVisit)
      await page.addInitScript(() => {
        try {
          if (!localStorage.getItem("opentv:onboarding:v1")) {
            localStorage.setItem("opentv:onboarding:v1", "done");
            localStorage.setItem("opentv:setup-reminder-hidden:v1", "1");
            // Sources start disconnected; a returning visitor has chosen these.
            const directory = (id: string) => ({
              id,
              name: id,
              kind: "directory",
              classification: "general",
              enabled: true,
            });
            localStorage.setItem(
              "opentv:sources:v1",
              JSON.stringify([
                {
                  id: "classic-films",
                  name: "Archive film collection",
                  kind: "m3u",
                  url: "/playlists/movies.m3u",
                  classification: "general",
                  enabled: true,
                },
                {
                  id: "open-cinema",
                  name: "Blender Open Movies",
                  kind: "catalog",
                  url: "/catalog/open-cinema.json",
                  classification: "general",
                  enabled: true,
                },
                {
                  id: "free-news",
                  name: "Free news channels",
                  kind: "m3u",
                  url: "/playlists/news.m3u",
                  classification: "general",
                  enabled: true,
                },
                ...[
                  "audio-somafm",
                  "nasa-apollo",
                  "nasa-space",
                  "archive-feature-films",
                  "archive-classic-tv",
                  "archive-cartoons",
                  "radio-top",
                ].map(directory),
              ]),
            );
            localStorage.setItem(
              "opentv:extension-enabled:v1",
              JSON.stringify({ "world-live": true }),
            );
          }
        } catch {
          /* Storage unavailable. */
        }
      });
    await page.route(
      /^https:\/\/(archive\.org|[a-z0-9-]+\.api\.radio-browser\.info|api\.tvmaze\.com|images-api\.nasa\.gov|(?:api\.)?somafm\.com)\//,
      (route) =>
        route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: route.request().url().includes("advancedsearch")
            ? { response: { docs: [] } }
            : [],
        }),
    );
    // A small synthetic extension stands in for the channel lists a real one provides.
    await page.route("**/extension.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: readFileSync(
          new URL("./fixtures/extension.json", import.meta.url),
          "utf8",
        ),
      }),
    );
    await use(page);
  },
});
export { expect };
// Settings is split into tabs; tests open the tab that holds the control they use.
export async function settingsTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}
export async function enablePrivateViewing(page: Page) {
  await settingsTab(page, "Privacy");
  // The age confirmation is only asked the first time on a device.
  const age = page.getByLabel(
    "I am 18+ and permitted to view adult content in my region.",
  );
  if (await age.isVisible()) await age.check();
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  // A TV has no Sources tab: its sources are managed from the phone.
  if (await page.getByRole("tab", { name: "Sources", exact: true }).count())
    await settingsTab(page, "Sources");
}
