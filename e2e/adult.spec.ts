import { test, expect, enablePrivateViewing, settingsTab } from "./viewer-test";

test("18+ stays on after a reload until it is hidden", async ({ page }) => {
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await expect(page.getByText("18+ content shown")).toBeVisible();
  await page.reload();
  await expect(page.getByText("18+ content shown")).toBeVisible();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByText("18+ content shown")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("18+ content shown")).toHaveCount(0);
});

test("with a PIN, the app asks for it before bringing 18+ back, and a trusted device does not", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await settingsTab(page, "Privacy");
  await page.getByLabel("Optional device PIN").fill("2468");
  await page.getByRole("button", { name: "Set device PIN" }).click();
  await page
    .getByLabel("I am 18+ and permitted to view adult content in my region.")
    .check();
  await page.getByLabel("Device PIN", { exact: true }).fill("2468");
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  await expect(page.getByText("18+ content shown")).toBeVisible();
  await page.reload();
  const prompt = page.getByRole("dialog", { name: /Show 18\+ content again/ });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("Device PIN").fill("0000");
  await prompt.getByRole("button", { name: "Show 18+ content" }).click();
  await expect(prompt.getByText("The PIN does not match.")).toBeVisible();
  await prompt.getByLabel("Device PIN").fill("2468");
  await prompt.getByLabel(/Trust this device/).check();
  await prompt.getByRole("button", { name: "Show 18+ content" }).click();
  await expect(page.getByText("18+ content shown")).toBeVisible();
  // Trusted now: the next open restores it without asking.
  await page.reload();
  await expect(page.getByText("18+ content shown")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: /Show 18\+ content again/ }),
  ).toHaveCount(0);
});

test("keeping it hidden at the prompt leaves 18+ off, and a PIN can be changed and removed", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await settingsTab(page, "Privacy");
  await page.getByLabel("Optional device PIN").fill("1357");
  await page.getByRole("button", { name: "Set device PIN" }).click();
  await page
    .getByLabel("I am 18+ and permitted to view adult content in my region.")
    .check();
  await page.getByLabel("Device PIN", { exact: true }).fill("1357");
  await page
    .getByRole("button", { name: "Show 18+ content", exact: true })
    .click();
  await expect(page.getByText("18+ content shown")).toBeVisible();
  await page.reload();
  await page
    .getByRole("dialog", { name: /Show 18\+ content again/ })
    .getByRole("button", { name: "Keep hidden" })
    .click();
  await expect(page.getByText("18+ content shown")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: /Show 18\+ content again/ }),
  ).toHaveCount(0);
  await settingsTab(page, "Privacy");
  await page.getByRole("button", { name: "Change PIN" }).click();
  await page.getByLabel("Current PIN").fill("1357");
  await page.getByLabel("New PIN").fill("9753");
  await page
    .getByRole("button", { name: "Change PIN", exact: true })
    .last()
    .click();
  await expect(page.getByText("Device PIN changed.")).toBeVisible();
  await page.getByRole("button", { name: "Remove PIN" }).click();
  await page.getByLabel("Current PIN").fill("9753");
  await page
    .getByRole("button", { name: "Remove PIN", exact: true })
    .last()
    .click();
  await expect(page.getByText("Device PIN removed.")).toBeVisible();
  await expect(page.getByLabel("Optional device PIN")).toBeVisible();
});

test("a playlist you added can be moved between General and 18+", async ({
  page,
}) => {
  await page.route("https://move-fixture.test/list.m3u", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: "#EXTM3U\n#EXTINF:-1,Move channel\nhttps://example.com/move.m3u8",
    }),
  );
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await settingsTab(page, "Sources");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect playlist", exact: true }),
  });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Mover");
  await form
    .getByRole("textbox", { name: "Playlist URL", exact: true })
    .fill("https://move-fixture.test/list.m3u");
  await form
    .getByRole("button", { name: "Connect playlist", exact: true })
    .click();
  await expect(page.getByText(/1 entr/).first()).toBeVisible();
  const row = page.locator(".source-row").filter({ hasText: "Mover" });
  await row.getByRole("button", { name: "Move to 18+" }).click();
  await settingsTab(page, "Privacy");
  await expect(
    page
      .locator("#settings-adult-sources .source-row")
      .filter({ hasText: "Mover" }),
  ).toBeVisible();
  await page
    .locator("#settings-adult-sources .source-row")
    .filter({ hasText: "Mover" })
    .getByRole("button", { name: "Move to General" })
    .click();
  await settingsTab(page, "Sources");
  await expect(
    page.locator("#settings-sources .source-row").filter({ hasText: "Mover" }),
  ).toBeVisible();
});
