import { test, expect } from "./viewer-test";
test("Shuffle stays inside the category filter", async ({ page }) => {
  const rows = (group: string, n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `#EXTINF:-1 group-title="${group}",${group} channel ${i + 1}\nhttps://example.com/${group}-${i}.m3u8`,
    ).join("\n");
  await page.route("https://filter-fixture.test/list.m3u", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: `#EXTM3U\n${rows("Alpha", 6)}\n${rows("Beta", 6)}`,
    }),
  );
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect playlist", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Filter fixture");
  await form
    .getByRole("textbox", { name: "Playlist URL", exact: true })
    .fill("https://filter-fixture.test/list.m3u");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form
    .getByRole("button", { name: "Connect playlist", exact: true })
    .click();
  await expect(page.getByText(/12 entr/).first()).toBeVisible();
  await page.goto("/#/live");
  await page.getByLabel("Filter category").selectOption("Alpha");
  await expect(
    page.getByRole("heading", { name: "Alpha channel 1" }).first(),
  ).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Shuffle", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText(/Alpha channel \d/)
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText(/Beta channel/),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});
