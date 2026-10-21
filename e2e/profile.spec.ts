import { test, expect, settingsTab } from "./viewer-test";
test("general profile import merges collections/favorites and export omits device PIN", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await settingsTab(page, "Privacy");
  await page.getByLabel("Optional device PIN", { exact: true }).fill("1234");
  await page
    .getByRole("button", { name: "Set device PIN", exact: true })
    .click();
  await expect(
    page.getByText("Device PIN is set.", { exact: false }),
  ).toBeVisible();
  const profile = {
    version: 1,
    kind: "open-tv-general-profile",
    profile: {
      version: 2,
      favorites: ["ot-orphaned"],
      collections: [
        {
          id: "ot-importedcollection",
          name: "Imported collection",
          itemIds: ["ot-orphaned"],
        },
      ],
      history: [{ id: "ot-orphaned", at: Date.now() }],
      progress: { "ot-orphaned": 42 },
      session: {
        route: "live",
        query: "",
        genre: "",
        scroll: {},
        views: {},
        library: { tab: "saved", limit: 72 },
        drafts: {},
      },
      preferences: {
        volume: 0.3,
        muted: false,
        pinHash: "injected-pin",
        pinSalt: "injected-salt",
      },
    },
  };
  await settingsTab(page, "Profiles & data");
  await page
    .getByLabel("Import general profile", { exact: true })
    .setInputFiles({
      name: "profile.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(profile)),
    });
  await expect(
    page.getByText("Profile merged.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("opentv:user:v2") || "{}",
        ).favorites?.includes("ot-orphaned"),
      ),
    )
    .toBe(true);
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("opentv:user:v2") || "{}"),
  );
  expect(persisted.favorites).toContain("ot-orphaned");
  expect(persisted.progress["ot-orphaned"]).toBe(42);
  expect(persisted.preferences.pinHash).not.toBe("injected-pin");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export general profile", exact: true })
    .click();
  const download = await downloading;
  const file = await download.createReadStream();
  let data = "";
  for await (const chunk of file!) data += chunk.toString();
  expect(data).toContain("Imported collection");
  expect(data).not.toMatch(/pinHash|pinSalt|injected-pin/);
  await page.getByRole("button", { name: "My Library", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Your collections", exact: true })
    .selectOption("ot-importedcollection");
  await expect(
    page.getByRole("heading", { name: "Imported collection", exact: true }),
  ).toBeVisible();
});
