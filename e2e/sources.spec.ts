import { test, expect, enablePrivateViewing } from "./viewer-test";
test("disconnect cancels a slow source and reconnect does not resurrect stale state", async ({
  page,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  await page.route(
    "https://source-fixture.test/channels.m3u",
    async (route) => {
      calls++;
      if (calls === 1) await blocked;
      await route
        .fulfill({
          status: 200,
          headers: { "access-control-allow-origin": "*" },
          body: '#EXTM3U\n#EXTINF:-1 group-title="News",Source fixture channel\nhttps://example.com/source-fixture.m3u8',
        })
        .catch(() => {});
    },
  );
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect playlist", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Slow fixture source");
  await form
    .getByRole("textbox", { name: "Playlist URL", exact: true })
    .fill("https://source-fixture.test/channels.m3u");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form
    .getByRole("button", { name: "Connect playlist", exact: true })
    .click();
  const row = page.locator(".source-row").filter({
    has: page.getByRole("heading", {
      name: "Slow fixture source",
      exact: true,
    }),
  });
  await expect.poll(() => calls).toBe(1);
  await row.getByRole("button", { name: "Disconnect", exact: true }).click();
  release();
  await expect(row.getByText("Disconnected", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(row.getByText(/1 entr/)).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("Source fixture channel");
  await expect(
    page.getByRole("heading", { name: "Source fixture channel", exact: true }),
  ).toBeVisible();
});
test("hiding 18+ while an account connects leaves the connection alone and stores no password", async ({
  page,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let requested = false;
  await page.route(
    "https://account-fixture.test/player_api.php**",
    async (route) => {
      const action = new URL(route.request().url()).searchParams.get("action");
      if (action === "get_live_categories") {
        await route.fulfill({
          json: [{ category_id: "1", category_name: "Unclassified" }],
          headers: { "access-control-allow-origin": "*" },
        });
        return;
      }
      requested = true;
      await blocked;
      await route
        .fulfill({
          json: [
            {
              stream_id: 1,
              name: "Private connection fixture",
              category_id: "1",
            },
          ],
          headers: { "access-control-allow-origin": "*" },
        })
        .catch(() => {});
    },
  );
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect account", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Server", exact: true })
    .fill("https://account-fixture.test");
  await form
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("fixture-user");
  await form.getByLabel("Password", { exact: true }).fill("fixture-secret");
  await form.getByLabel("Remember on this device").uncheck();
  await form
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  release();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("Private connection fixture");
  await expect(
    page
      .getByRole("heading", {
        name: "Private connection fixture",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("fixture-secret");
});
