import { test, expect, enablePrivateViewing } from "./viewer-test";
import type { Page } from "@playwright/test";
const endpoint = "https://guide-fixture.test/schedule.xml?token=guide-secret";
const stamp = (ms: number) =>
  new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
function xml(title: string, now: number) {
  return `<?xml version="1.0"?><tv><programme channel="FixtureNews" start="${stamp(now - 3600000)}" stop="${stamp(now + 10800000)}"><title>${title}</title></programme><programme channel="FixtureNews" start="${stamp(now + 10800000)}" stop="${stamp(now + 14400000)}"><title>Adult porn fixture must stay hidden</title></programme></tv>`;
}
async function catalog(page: Page) {
  await page.route("**/extension.json", (route) =>
    route.fulfill({
      json: {
        format: "open-tv-extension",
        version: 1,
        name: "Guide fixture",
        sources: [
          {
            id: "world-live",
            name: "Guide fixture channels",
            kind: "catalog",
            enabled: true,
            items: [
              {
                id: "ot-guidenews",
                title: "Guide news fixture",
                providerId: "world-live",
                type: "live",
                epgId: "FixtureNews",
                classification: "general",
                genres: ["News"],
                languages: ["English"],
                countries: ["US"],
                availability: "playable",
                streams: [
                  {
                    url: "https://video-fixture.test/news.m3u8",
                    format: "hls",
                  },
                ],
                rights: { status: "provider-listed" },
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/playlists/*.m3u", (route) =>
    route.fulfill({ body: "#EXTM3U\n", contentType: "text/plain" }),
  );
}
async function connect(page: Page, url = endpoint) {
  const form = page.getByRole("form", {
    name: "Connect XMLTV guide",
    exact: true,
  });
  await form.getByLabel("XMLTV guide URL", { exact: true }).fill(url);
  await form.getByRole("checkbox").check();
  await form
    .getByRole("button", { name: "Connect guide", exact: true })
    .click();
}
test("authorized URL refresh retains good schedules through failure and never persists tokens or restricted programs", async ({
  page,
  context,
}) => {
  await catalog(page);
  await page.clock.install({ time: new Date() });
  let requests = 0;
  const headers: Record<string, string>[] = [];
  await context.addCookies([
    {
      name: "account-cookie",
      value: "cookie-secret",
      domain: "guide-fixture.test",
      path: "/",
      secure: true,
      sameSite: "None",
    },
  ]);
  await page.route("https://guide-fixture.test/**", async (route) => {
    requests++;
    headers.push(await route.request().allHeaders());
    await route.fulfill({
      status: requests === 2 ? 503 : 200,
      contentType: "application/xml",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: xml(
        requests >= 3 ? "Updated guide fixture" : "Current guide fixture",
        await page.evaluate(() => Date.now()),
      ),
    });
  });
  await page.goto("/#/settings");
  await connect(page);
  await expect(page.locator("[data-guide-status]")).toHaveAttribute(
    "data-guide-status",
    "ready",
  );
  expect(requests).toBe(1);
  expect(headers[0].cookie).toBeUndefined();
  expect(headers[0].referer).toBeUndefined();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Live TV", exact: true })
    .click();
  await page.getByRole("button", { name: "TV guide", exact: true }).click();
  await expect(
    page.getByText("Current guide fixture", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Adult porn fixture must stay hidden", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await page.clock.fastForward(16000);
  await page
    .getByRole("button", { name: "Refresh guide", exact: true })
    .click();
  await expect(page.locator("[data-guide-status]")).toHaveAttribute(
    "data-guide-status",
    "error",
  );
  await page.clock.fastForward(120000);
  await expect(page.locator("[data-guide-status]")).toHaveAttribute(
    "data-guide-status",
    "ready",
  );
  expect(requests).toBe(3);
  const saved = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(saved).not.toMatch(
    /guide-secret|schedule.xml|Current guide fixture|Updated guide fixture/,
  );
  await page.reload();
  await expect(page.locator("[data-guide-status]")).toHaveAttribute(
    "data-guide-status",
    "empty",
  );
  expect(requests).toBe(3);
});
test("showing 18+ keeps the guide loaded and refreshing; a native suspend pauses it", async ({
  page,
}) => {
  await catalog(page);
  await page.clock.install({ time: new Date() });
  let requests = 0;
  await page.route("https://guide-fixture.test/**", async (route) => {
    requests++;
    await route.fulfill({
      contentType: "application/xml",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: xml("Fixture schedule", await page.evaluate(() => Date.now())),
    });
  });
  await page.goto("/#/settings");
  await connect(page);
  const status = page.locator("[data-guide-status]");
  await expect(status).toHaveAttribute("data-guide-status", "ready");
  await enablePrivateViewing(page);
  await expect(page.locator(".private-banner")).toBeVisible();
  // 18+ only adds: the same guide stays, and keeps its schedule fresh.
  await expect(status).toHaveAttribute("data-guide-status", "ready");
  await page.clock.fastForward(2 * 3600000 + 60000);
  await expect.poll(() => requests).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:suspend")));
  await page.clock.fastForward(2 * 3600000 + 60000);
  expect(requests).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:resume")));
  await expect.poll(() => requests).toBe(3);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
test("malformed and entity-based guide imports preserve the previous schedule", async ({
  page,
}) => {
  await catalog(page);
  await page.goto("/#/settings");
  const file = page.locator('input[type="file"][accept=".xml,.xmltv"]');
  await file.setInputFiles({
    name: "guide.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(xml("Good guide fixture", Date.now())),
  });
  await expect(page.locator("[data-guide-status]")).toHaveAttribute(
    "data-guide-status",
    "ready",
  );
  for (const value of [
    '<!DOCTYPE tv [<!ENTITY bad SYSTEM "https://never-fetch.test/file">]><tv><programme>&bad;</programme></tv>',
    "<html>Fake HTTP 200</html>",
    "<tv><programme",
  ]) {
    await file.setInputFiles({
      name: "bad.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(value),
    });
    await expect(
      page.getByText(
        "Couldn’t read that guide. Use an uncompressed XMLTV file.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator("[data-guide-status]")).toHaveAttribute(
      "data-guide-status",
      "ready",
    );
  }
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Live TV", exact: true })
    .click();
  await page.getByRole("button", { name: "TV guide", exact: true }).click();
  await expect(
    page.getByText("Good guide fixture", { exact: true }).first(),
  ).toBeVisible();
});
test("the published guide loads from its raw address, refreshes, and a guide that never loaded says why", async ({
  page,
}) => {
  await catalog(page);
  await page.clock.install({ time: new Date() });
  const raw =
    "https://raw.githubusercontent.com/matthuisman/i.mjh.nz/refs/heads/master/SamsungTVPlus/us.xml";
  let requests = 0,
    reachable = true;
  await page.route(raw, async (route) => {
    requests++;
    if (!reachable) return route.abort("connectionrefused");
    await route.fulfill({
      contentType: "text/plain; charset=utf-8",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: xml("Samsung fixture show", await page.evaluate(() => Date.now())),
    });
  });
  const status = page.locator("[data-guide-status]");
  const guide = async () => {
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Live TV", exact: true })
      .click();
    await page.getByRole("button", { name: "TV guide", exact: true }).click();
  };
  await page.goto("/#/settings");
  await connect(page, raw);
  await expect(status).toHaveAttribute("data-guide-status", "ready");
  await page.clock.fastForward(16000);
  await page
    .getByRole("button", { name: "Refresh guide", exact: true })
    .click();
  await expect.poll(() => requests).toBe(2);
  await expect(status).toHaveAttribute("data-guide-status", "ready");
  await guide();
  await expect(
    page.getByText("Samsung fixture show", { exact: true }).first(),
  ).toBeVisible();

  // A fresh visit with the guide host unreachable: there is no last schedule to show.
  reachable = false;
  await page.goto("/#/settings");
  await page.reload();
  await connect(page, raw);
  await expect(status).toHaveAttribute("data-guide-status", "error");
  await expect(status).toContainText("The guide hasn’t loaded yet.");
  await expect(status).toContainText("could not reach the guide");
  await guide();
  const banner = page.locator(".guide-source-status [role=status]");
  await expect(banner).toContainText("The guide hasn’t loaded yet.");
  await expect(banner).toContainText("could not reach the guide");
  await expect(banner).not.toContainText("last schedule");
});
