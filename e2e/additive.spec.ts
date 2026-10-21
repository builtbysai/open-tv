import { test, expect, enablePrivateViewing, settingsTab } from "./viewer-test";
import type { Page } from "@playwright/test";

// Showing 18+ only adds: nothing is hidden, dropped or left unsaved by turning it on or off.
const lists: Record<string, string> = {
  "https://lists.test/comic.m3u":
    "#EXTM3U\n#EXTINF:-1,Funny One\nhttps://example.com/1.m3u8\n#EXTINF:-1,Funny Two\nhttps://example.com/2.m3u8",
  "https://lists.test/news.m3u":
    "#EXTM3U\n#EXTINF:-1,Funny Bulletin\nhttps://example.com/3.m3u8",
  "https://lists.test/late.m3u":
    "#EXTM3U\n#EXTINF:-1,Funny Late Show\nhttps://example.com/4.m3u8",
};
async function serveLists(page: Page) {
  await page.route("https://lists.test/**", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      body: lists[route.request().url()] ?? "",
    }),
  );
}
async function addPlaylist(
  page: Page,
  name: string,
  url: string,
  classification: "general" | "adult" = "general",
) {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect playlist", exact: true }),
  });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await form
    .getByRole("textbox", { name: "Playlist URL", exact: true })
    .fill(url);
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption(classification);
  await form
    .getByRole("button", { name: "Connect playlist", exact: true })
    .click();
}
const results = (page: Page) =>
  page.getByRole("button", { name: /^Details for Funny/ });
async function search(page: Page, text: string) {
  await page.goto("/#/search");
  await page.getByLabel("Search catalog").fill(text);
}

test("playlists added while 18+ is shown, including one with a trigger word, stay general and saved", async ({
  page,
}) => {
  await serveLists(page);
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await addPlaylist(
    page,
    "Comic Strip Theater",
    "https://lists.test/comic.m3u",
  );
  await addPlaylist(page, "Evening news", "https://lists.test/news.m3u");
  for (const name of ["Comic Strip Theater", "Evening news"])
    await expect(
      page
        .locator("#settings-sources .source-row")
        .filter({ hasText: name })
        .filter({ hasText: /entr/ }),
    ).toBeVisible();
  await search(page, "funny");
  await expect(results(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  // Hiding 18+ changes nothing here: same screen, same text, same results.
  await expect(page.getByLabel("Search catalog")).toHaveValue("funny");
  await expect(results(page)).toHaveCount(3);
  await page.reload();
  await expect(page.getByLabel("Search catalog")).toHaveValue("funny");
  await expect(results(page)).toHaveCount(3);
  await page.goto("/#/settings");
  await settingsTab(page, "Sources");
  for (const name of ["Comic Strip Theater", "Evening news"])
    await expect(
      page.locator("#settings-sources .source-row").filter({ hasText: name }),
    ).toBeVisible();
});

test("an 18+ playlist is remembered, hidden while 18+ is and back when it is shown, adding to search", async ({
  page,
}) => {
  await serveLists(page);
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await addPlaylist(page, "Evening news", "https://lists.test/news.m3u");
  await addPlaylist(page, "Late", "https://lists.test/late.m3u", "adult");
  await search(page, "funny");
  await expect(results(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(results(page)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Details for Funny Late Show" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(results(page)).toHaveCount(1);
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await search(page, "funny");
  // Nothing to reconnect by hand: the 18+ list was remembered like any other.
  await expect(results(page)).toHaveCount(2);
});

test("a server added while 18+ is shown is kept after hiding it and reloading", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await settingsTab(page, "Sources");
  await page.getByRole("button", { name: "Add server" }).first().click();
  const form = page.getByRole("form", { name: "Add media server" });
  await form.getByLabel("Server name").fill("Den server");
  await form.getByLabel("Server address").fill("https://den.test");
  await form.getByLabel("I am authorized to use this server").check();
  await form.getByRole("button", { name: "Create server" }).click();
  await expect(page.getByText("Den server").first()).toBeVisible();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.reload();
  await settingsTab(page, "Sources");
  await expect(page.getByText("Den server").first()).toBeVisible();
});
