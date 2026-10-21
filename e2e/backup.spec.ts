import { test, expect, settingsTab } from "./viewer-test";
test("a backup carries sources and the saved list to another browser", async ({
  page,
  browser,
}) => {
  await page.goto("/#/settings");
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Playlist URL") });
  await form.getByLabel("Name").fill("Backup list");
  await form
    .getByLabel("Playlist URL")
    .fill("https://backup.example.com/list.m3u");
  await form.getByLabel("Classification").selectOption("general");
  await form.getByRole("button", { name: "Connect playlist" }).click();
  await expect(
    page.getByRole("heading", { name: "Backup list" }),
  ).toBeVisible();
  await settingsTab(page, "Profiles & data");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const file = await (await download).path();
  const other = await browser.newContext();
  // The other browser is a returning visitor; the welcome has its own test.
  await other.addInitScript(() =>
    localStorage.setItem("opentv:onboarding:v1", "done"),
  );
  const fresh = await other.newPage();
  await fresh.goto("/#/settings");
  await settingsTab(fresh, "Profiles & data");
  await fresh.getByLabel("Import backup").setInputFiles(file);
  await expect(fresh.getByText("Backup restored.")).toBeVisible();
  await settingsTab(fresh, "Sources");
  await expect(
    fresh.getByRole("heading", { name: "Backup list" }),
  ).toBeVisible();
  await other.close();
});
test("importing something that is not a backup changes nothing", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await settingsTab(page, "Profiles & data");
  await page.getByLabel("Import backup").setInputFiles({
    name: "x.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ hello: "world" })),
  });
  await expect(page.getByText("Choose an Open TV backup file.")).toBeVisible();
});
