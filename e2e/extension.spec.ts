import { test, expect, enablePrivateViewing, settingsTab } from "./viewer-test";

const playlist = (title: string) =>
  `#EXTM3U\n#EXTINF:-1 group-title="Test",${title}\nhttps://ext-fixture.test/${title.replace(/\W/g, "")}.m3u8`;
const extension = {
  format: "open-tv-extension",
  version: 1,
  name: "My device extension",
  sources: [
    {
      id: "my-list",
      name: "My own list",
      kind: "m3u",
      m3u: playlist("Device Channel"),
    },
    {
      id: "my-private-list",
      name: "My private list",
      kind: "m3u",
      classification: "adult",
      m3u: playlist("Private Channel"),
    },
  ],
};
const upload = (page: import("@playwright/test").Page) =>
  page.locator('#settings-extension input[type="file"]').setInputFiles({
    name: "extension.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(extension)),
  });

test("an extension served by the site is listed as coming from the site", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await expect(
    page.locator("#settings-extension").getByText(/served by this site/),
  ).toBeVisible();
  await expect(
    page.locator("#settings-extension").getByRole("button", {
      name: "Remove extension",
    }),
  ).toHaveCount(0);
});
test("an imported extension stays on the device, adds its sources, and keeps 18+ lists hidden", async ({
  page,
}) => {
  await page.route("**/extension.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/#/settings");
  await upload(page);
  await expect(page.locator("#settings-extension")).toContainText(
    "Added 2 sources",
  );
  await page.reload();
  const section = page.locator("#settings-extension");
  await expect(section).toContainText("My device extension");
  await expect(section).toContainText("1 18+");
  // The general list is a source to connect; the 18+ one is not shown yet.
  const general = page
    .locator(".source-row")
    .filter({ hasText: "My own list" });
  await expect(general).toBeVisible();
  await expect(page.getByText("My private list")).toHaveCount(0);
  await general.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(general).toContainText("1 entry");
  await page.getByRole("button", { name: "Live TV", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Details for Device Channel" }),
  ).toBeVisible();
  // Showing 18+ content lists the 18+ source from the same file.
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await settingsTab(page, "Sources");
  await expect(
    page.getByRole("heading", { name: "My private list", exact: true }),
  ).toBeVisible();
});
test("a file that is not an extension is refused and removing one takes its sources away", async ({
  page,
}) => {
  await page.route("**/extension.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/#/settings");
  await page.locator('#settings-extension input[type="file"]').setInputFiles({
    name: "other.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect(page.locator("#settings-extension")).toContainText(
    "not an Open TV extension",
  );
  await upload(page);
  await expect(
    page.locator(".source-row").filter({ hasText: "My own list" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove extension" }).click();
  await expect(
    page.locator(".source-row").filter({ hasText: "My own list" }),
  ).toHaveCount(0);
});
test("an extension loads from an https address, is refreshed on the next visit and keeps the address private", async ({
  page,
}) => {
  await page.route("**/extension.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  let version = "Remote One";
  await page.route("https://ext-host.test/**", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify({
        ...extension,
        name: "Remote extension",
        sources: [
          { id: "remote-list", name: version, kind: "m3u", m3u: playlist("R") },
        ],
      }),
    }),
  );
  await page.goto("/#/settings");
  const section = page.locator("#settings-extension");
  await section.getByLabel("Extension address").fill("http://ext-host.test/x");
  await section.getByRole("button", { name: "Load from address" }).click();
  await expect(section).toContainText("https://");
  await section
    .getByLabel("Extension address")
    .fill("https://ext-host.test/x?token=secret");
  await section.getByRole("button", { name: "Load from address" }).click();
  await expect(section).toContainText("Added 1 source");
  await expect(section).toContainText("loaded from ext-host.test");
  await expect(section).not.toContainText("secret");
  await expect(
    page.locator(".source-row").filter({ hasText: "Remote One" }),
  ).toBeVisible();
  version = "Remote Two";
  await page.reload();
  await expect(
    page.locator(".source-row").filter({ hasText: "Remote Two" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove extension" }).click();
  await page.reload();
  await expect(section.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  await expect(
    page.locator(".source-row").filter({ hasText: "Remote" }),
  ).toHaveCount(0);
});
test("an extension with settings adds music instances once, keeps the lists already imported, and a removed instance stays removed", async ({
  page,
}) => {
  await page.route("**/extension.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route("https://settings-inv.test/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.goto("/#/settings");
  await upload(page);
  await expect(page.locator("#settings-extension")).toContainText(
    "Added 2 sources",
  );
  await page.locator('#settings-extension input[type="file"]').setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "open-tv-extension",
        version: 1,
        name: "My settings",
        musicProviders: [
          {
            name: "Fixture Invidious",
            type: "invidious",
            base: "https://settings-inv.test",
          },
        ],
      }),
    ),
  });
  await expect(page.locator("#settings-extension")).toContainText(
    "Added 1 music instance",
  );
  // The lists from the earlier file are still there.
  await expect(
    page.locator(".source-row").filter({ hasText: "My own list" }),
  ).toBeVisible();
  const providers = page.locator("#music-providers");
  await expect(providers).toContainText("Fixture Invidious");
  await providers
    .getByRole("button", { name: "Remove provider Fixture Invidious" })
    .click();
  await page.reload();
  await expect(page.locator("#music-providers")).not.toContainText(
    "Fixture Invidious",
  );
});
test("an extension split into data files loads only the index at start and fetches a list when it is connected", async ({
  page,
}) => {
  const requested: string[] = [];
  const channel = {
    id: "ot-shard1",
    providerId: "shard",
    title: "Shard Channel",
    type: "live",
    genres: [],
    languages: [],
    countries: ["Chile"],
    classification: "general",
    availability: "playable",
    streams: [{ url: "https://shard.example/1.m3u8", format: "hls" }],
    rights: { status: "provider-listed" },
  };
  await page.route("**/extension.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        format: "open-tv-extension",
        version: 1,
        name: "Split pack",
        sources: [
          {
            id: "shard-1",
            name: "Shard list",
            kind: "catalog",
            url: "extension-data/shard-1.json",
          },
        ],
      }),
    }),
  );
  await page.route("**/extension-data/shard-1.json", (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [channel] }),
    });
  });
  await page.goto("/#/settings");
  const row = page.locator(".source-row").filter({ hasText: "Shard list" });
  await expect(row).toBeVisible();
  expect(requested).toHaveLength(0);
  await row.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(row).toContainText("1 entry");
  expect(requested).toHaveLength(1);
});
test("the parts of one split list show as a single entry with connect-all", async ({
  page,
}) => {
  await page.route("**/extension.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        format: "open-tv-extension",
        version: 1,
        name: "Parts",
        sources: ["a", "b", "c"].map((x, i) => ({
          id: `world-${i + 1}`,
          name: `World · Part ${x.toUpperCase()}`,
          kind: "catalog",
          url: `extension-data/world-${i + 1}.json`,
        })),
      }),
    }),
  );
  await page.route("**/extension-data/*.json", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"items":[]}' }),
  );
  await page.goto("/#/settings");
  const group = page.locator(".source-group");
  await expect(group).toContainText("World");
  await expect(group).toContainText("0 of 3 parts connected");
  await group.getByRole("button", { name: "Connect all" }).click();
  await expect(group).toContainText("3 of 3 parts connected");
  await group.getByText("Parts", { exact: true }).click();
  await expect(group.locator(".source-row")).toHaveCount(3);
});
