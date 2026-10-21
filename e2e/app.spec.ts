import { test, expect, enablePrivateViewing, settingsTab } from "./viewer-test";
const cinemaTitle = "Big Buck Bunny";
test("Home, favorites, search, refresh restoration and progressive live grid", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  const detailButton = page
    .getByRole("button", { name: `Details for ${cinemaTitle}`, exact: true })
    .first();
  await detailButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await expect(detailButton).toBeFocused();
  await page
    .getByRole("button", { name: `Save ${cinemaTitle}`, exact: true })
    .first()
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "My Library" })
    .click();
  await expect(
    page.getByRole("heading", { name: cinemaTitle, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: cinemaTitle, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByPlaceholder("Search channels, films and series")
    .fill("Sintel");
  await expect(
    page.getByRole("heading", { name: "Sintel", exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByPlaceholder("Search channels, films and series"),
  ).toHaveValue("Sintel");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Live TV", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Skip to content", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page).toHaveURL(/#\/live$/);
  await expect(
    page.locator(".content-grid .content-card").first(),
  ).toBeVisible();
  await expect(page.locator(".content-grid .content-card")).toHaveCount(72);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".content-grid .content-card")).toHaveCount(144);
  expect(errors).toEqual([]);
});
test("private imports stay out of search, thumbnails, session, and restored state", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByLabel("Title", { exact: true }).fill("Private test fixture");
  await form
    .getByLabel("Media URL", { exact: true })
    .fill("https://example.com/private.mp4?token=secret");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("adult");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByPlaceholder("Search channels, films and series")
    .fill("Private test fixture");
  await expect(
    page.getByRole("heading", { name: "Private test fixture", exact: true }),
  ).toHaveCount(0);
  // General searches are restorable. Establish a separate saved general query
  // before checking that the subsequent private query never reaches storage.
  await page.getByRole("searchbox").fill("Sintel");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("opentv:user:v2") || "{}").session
            ?.query,
      ),
    )
    .toBe("Sintel");
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await enablePrivateViewing(page);
  await expect(page.locator(".private-banner")).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByPlaceholder("Search channels, films and series")
    .fill("Private test fixture");
  await expect(
    page.getByRole("heading", { name: "Private test fixture", exact: true }),
  ).toBeVisible();
  const state = await page.evaluate(() =>
    localStorage.getItem("opentv:user:v2"),
  );
  expect(state).not.toContain("secret");
  expect(state).not.toContain("Private test fixture");
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Private test fixture", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".private-banner")).toHaveCount(0);
});
test("guide shows an honest empty state before importing schedules", async ({
  page,
}) => {
  await page.goto("/#/live");
  await page.getByRole("button", { name: "TV guide", exact: true }).click();
  await expect(
    page.getByText("Program information unavailable").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Import an XMLTV guide in Settings").first(),
  ).toBeVisible();
});
test("mobile and television Home layouts have no page overflow", async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
});

test("imports XMLTV and renders matched Now/Next programming", async ({
  page,
}) => {
  const channel = { epgId: "FixtureGuide" };
  const stamp = (date: Date) =>
    date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
  const now = Date.now();
  const xml = `<?xml version="1.0"?><tv><programme channel="${channel.epgId}" start="${stamp(new Date(now - 3600000))}" stop="${stamp(new Date(now + 3600000))}"><title>Matched current program</title></programme><programme channel="${channel.epgId}" start="${stamp(new Date(now + 3600000))}" stop="${stamp(new Date(now + 7200000))}"><title>Matched next program</title></programme></tv>`;
  await page.goto("/#/settings");
  await page.locator('input[type="file"][accept=".xml,.xmltv"]').setInputFiles({
    name: "guide.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(xml),
  });
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Live TV", exact: true })
    .click();
  await page.getByRole("button", { name: "TV guide", exact: true }).click();
  await expect(
    page.getByText("Matched current program", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Matched next program/).first()).toBeVisible();
});
