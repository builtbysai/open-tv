import { test, expect } from "./viewer-test";
import { mockRelay } from "./relay-mock";
test.use({ freshVisit: true });
const EXTENSION_LIST = "Fixture channels";
test("a first visit opens the welcome, and finishing it sets things up once", async ({
  page,
  context,
}) => {
  await mockRelay(context);
  await page.route("https://api.themoviedb.org/**", (route) =>
    route.fulfill({ json: { results: [] } }),
  );
  await page.goto("/#/home");
  await expect(
    page.getByRole("dialog", {
      name: /Set up on this device|Bring your servers/,
    }),
  ).toBeVisible();
  const welcome = page.getByRole("dialog");
  await expect(welcome.getByText("Step 1 of 4")).toBeVisible();
  // Step 1: a phone sends a playlist through the QR code (a desktop keeps it one tap away).
  await welcome.getByText("Send them from a phone instead").click();
  const link = (await welcome
    .getByRole("img", { name: "QR code for phone setup" })
    .getAttribute("data-value"))!;
  const phone = await context.newPage();
  await phone.goto(link);
  await phone
    .getByLabel("Playlist URLs")
    .fill("https://setup.example.com/tv.m3u");
  await phone.getByLabel("Classification").selectOption("general");
  await phone.getByRole("button", { name: "Send to TV" }).click();
  await expect(phone.getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect(welcome.getByText("Received from your phone")).toBeVisible();
  await welcome.getByRole("button", { name: "Import", exact: true }).click();
  await expect(welcome.getByText("Your sources are connected.")).toBeVisible();
  await welcome.getByRole("button", { name: "Next", exact: true }).click();
  // Step 2: choose sources; nothing is connected until chosen.
  const choices = welcome.getByRole("group", { name: "Sources" });
  const somafm = choices.getByRole("button", { name: /SomaFM/ });
  await expect(somafm).toHaveAttribute("aria-pressed", "false");
  await somafm.click();
  await expect(somafm).toHaveAttribute("aria-pressed", "true");
  await welcome.getByRole("button", { name: /Show all \d+ sources/ }).click();
  await welcome.getByRole("button", { name: "Next", exact: true }).click();
  // Step 3: a TMDB key.
  await welcome
    .getByLabel("API key or read access token")
    .fill("abcdef0123456789");
  await welcome.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(welcome.getByText("TMDB is connected.")).toBeVisible();
  await welcome.getByRole("button", { name: "Next", exact: true }).click();
  // Step 4: a name and a Kids profile.
  await welcome.getByLabel("Your name").fill("Sai");
  await welcome.getByLabel(/Also add a Kids profile/).check();
  await welcome.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:onboarding:v1")),
  ).toBe("done");
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:tmdb-key:v1")),
  ).toBe("abcdef0123456789");
  await expect(page.getByRole("region", { name: "Finish setup" })).toHaveCount(
    0,
  );
  await page.reload();
  // Two profiles now, so the next visit asks who is watching.
  await expect(page.getByRole("button", { name: "Sai" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kids" })).toBeVisible();
});
test("skipping leaves a slim reminder, and Settings can run the welcome again", async ({
  page,
}) => {
  await page.goto("/#/home");
  const welcome = page.getByRole("dialog", {
    name: /Set up on this device|Bring your servers/,
  });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const reminder = page.getByRole("region", { name: "Finish setup" });
  await expect(
    reminder.getByText("TMDB key for trending titles"),
  ).toBeVisible();
  await expect(
    reminder.getByText("A source of channels or servers"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(reminder).toBeVisible();
  await reminder.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("dialog", {
      name: /Set up on this device|Bring your servers/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await reminder.getByRole("button", { name: "Hide this reminder" }).click();
  await expect(reminder).toHaveCount(0);
  await page.getByRole("button", { name: "Settings and sources" }).click();
  await page.getByRole("button", { name: "Run guided setup" }).click();
  await expect(
    page.getByRole("dialog", {
      name: /Set up on this device|Bring your servers/,
    }),
  ).toBeVisible();
});
test("Escape or Back skips the welcome", async ({ page }) => {
  await page.goto("/#/home");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:onboarding:v1")),
  ).toBe("skipped");
});

test("a fresh install connects nothing; the sources you choose stay chosen", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("opentv:onboarding:v1", "done");
    localStorage.setItem("opentv:setup-reminder-hidden:v1", "1");
  });
  await page.goto("/#/settings");
  const sources = page.locator("#settings-sources");
  await sources.getByRole("button", { name: "Browse more sources" }).click();
  await expect(sources.locator(".source-mark.enabled")).toHaveCount(0);
  await expect(page.locator("#settings-extension")).toBeVisible();
  const row = (name: string) =>
    sources.locator(".source-row").filter({ hasText: name }).first();
  await row("Blender Open Movies")
    .getByRole("button", { name: "Connect" })
    .click();
  await row("SomaFM").getByRole("button", { name: "Connect" }).click();
  // One from the extension too: its choice must survive the extension loading later.
  await row(EXTENSION_LIST).getByRole("button", { name: "Connect" }).click();
  await expect(sources.locator(".source-mark.enabled")).toHaveCount(3);
  await page.reload();
  await sources.getByRole("button", { name: "Browse more sources" }).click();
  await expect(sources.locator(".source-mark.enabled")).toHaveCount(3);
  await expect(row(EXTENSION_LIST).locator(".source-mark")).toHaveClass(
    /enabled/,
  );
  await expect(row("Blender Open Movies").locator(".source-mark")).toHaveClass(
    /enabled/,
  );
  await expect(row("SomaFM").locator(".source-mark")).toHaveClass(/enabled/);
});

test("the phone's chosen sources can be connected on the TV in one send", async ({
  browser,
}) => {
  const topics = new Map<string, { id: string; message: string }[]>();
  const tvContext = await browser.newContext({
    viewport: { width: 960, height: 540 },
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 420, height: 860 },
  });
  for (const context of [tvContext, phoneContext]) {
    await mockRelay(context, topics);
    await context.addInitScript(() => {
      localStorage.setItem("opentv:onboarding:v1", "done");
      localStorage.setItem("opentv:setup-reminder-hidden:v1", "1");
    });
  }
  // The phone has chosen SomaFM and the Blender films.
  await phoneContext.addInitScript(() => {
    if (!localStorage.getItem("opentv:sources:v1"))
      localStorage.setItem(
        "opentv:sources:v1",
        JSON.stringify([
          {
            id: "audio-somafm",
            name: "SomaFM",
            kind: "directory",
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
        ]),
      );
  });
  const tv = await tvContext.newPage();
  const phone = await phoneContext.newPage();
  await tv.goto("/?tv=1");
  const qr = tv.getByRole("img", { name: /QR code/ });
  const link = new URL((await qr.getAttribute("data-value"))!);
  await phone.goto(`/${link.hash}`);
  const same = phone.getByLabel(/Connect the same 2 sources on the TV/);
  await expect(same).toBeChecked();
  await phone.getByRole("button", { name: "Send to TV" }).click();
  await expect(phone.getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect(tv.getByText("2 sources to connect")).toBeVisible({
    timeout: 15000,
  });
  await tv.getByRole("button", { name: "Import" }).click();
  await tv.getByRole("button", { name: "Settings", exact: true }).click();
  const sources = tv.locator("#settings-sources");
  await expect(sources.locator(".source-mark.enabled")).toHaveCount(2);
  await tvContext.close();
  await phoneContext.close();
});
