import { test, expect, enablePrivateViewing, settingsTab } from "./viewer-test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
test("public batch checks are serial, bounded, cached and do not remove failed listings", async ({
  page,
}) => {
  const samples = [
    {
      id: "ot-sample1",
      title: "Sample video",
      url: "https://probe-fixture.test/master.m3u8",
      format: "hls",
    },
    {
      id: "ot-sample2",
      title: "Sample audio",
      url: "https://audio-probe.test/audio.m3u8",
      format: "hls",
    },
    {
      id: "ot-sample3",
      title: "Sample fake",
      url: "https://fake-probe.test/movie.mp4",
      format: "video",
    },
  ];
  await page.route("**/catalog/*.json", (route) =>
    route.fulfill({
      json: {
        version: 1,
        generatedAt: new Date().toISOString(),
        items: new URL(route.request().url()).pathname.endsWith(
          "open-cinema.json",
        )
          ? samples.map((s) => ({
              id: s.id,
              providerId: "open-cinema",
              title: s.title,
              type: "live",
              genres: ["News"],
              languages: [],
              countries: [],
              classification: "general",
              availability: "playable",
              streams: [{ url: s.url, format: s.format }],
              rights: { status: "provider-listed" },
            }))
          : [],
      },
    }),
  );
  await page.route("**/playlists/*.m3u", (route) =>
    route.fulfill({ body: "#EXTM3U\n", contentType: "text/plain" }),
  );
  await fixtures(page);
  await fixtures(page, "https://audio-probe.test");
  await page.route("https://fake-probe.test/movie.mp4", (route) =>
    route.fulfill({ body: "not video", contentType: "video/mp4" }),
  );
  let mediaRequests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).hostname.endsWith(".test")) mediaRequests++;
  });
  await page.goto("/#/live");
  await expect(
    page.getByRole("button", { name: "Details for Sample video", exact: true }),
  ).toBeVisible();
  expect(mediaRequests).toBe(0);
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await settingsTab(page, "This device");
  await page
    .getByRole("button", { name: "Check public stream sample", exact: true })
    .click();
  await expect(page.locator(".video-check-results li")).toHaveCount(3);
  await expect(page.locator(".video-check-results")).toContainText(
    "video-confirmed",
  );
  await expect(page.locator(".video-check-results")).toContainText(
    "audio-only",
  );
  await expect(page.locator(".video-check-results")).toContainText("failed");
  await expect(
    page.getByRole("button", {
      name: "Check public stream sample",
      exact: true,
    }),
  ).toBeEnabled();
  const requests = mediaRequests;
  await settingsTab(page, "This device");
  await page
    .getByRole("button", { name: "Check public stream sample", exact: true })
    .click();
  await expect(
    page.getByText("No eligible unchecked HTTPS sources.", { exact: false }),
  ).toBeVisible();
  expect(mediaRequests).toBe(requests);
  await page.getByRole("button", { name: "Live TV", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Details for Sample fake", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Details for Sample fake", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Report this listing", exact: true })
    .click();
  expect(
    await page
      .getByRole("link", { name: "Open GitHub listing report", exact: false })
      .getAttribute("href"),
  ).toContain("content_id=ot-sample3");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Content reports", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("suspending a pending video check aborts it without saving evidence", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://slow-probe.test/master.m3u8", async (route) => {
    await pending;
    await route
      .fulfill({
        body: "#EXTM3U\n",
        contentType: "application/vnd.apple.mpegurl",
      })
      .catch(() => {});
  });
  await page.goto("/#/settings");
  await add(
    page,
    "Pending video sample",
    "https://slow-probe.test/master.m3u8",
  );
  const requested = page.waitForRequest("https://slow-probe.test/master.m3u8");
  await page.getByRole("button", { name: "Check video", exact: true }).click();
  await requested;
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:suspend")));
  await expect(page.locator('[data-probe-status="aborted"]')).toBeVisible();
  await expect(page.locator(".probe-video")).not.toBeVisible();
  expect(await page.locator(".probe-video").getAttribute("src")).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:video-health:v1")),
  ).toBeNull();
  release();
});
async function mockDevice(page: Page) {
  await page.addInitScript(() => {
    const state = window as Window & { deviceMessages?: string[] };
    state.deviceMessages = [];
    window.OpenTVDevice = {
      postMessage: (value) => state.deviceMessages!.push(value),
    };
  });
}
async function fixtures(page: Page, origin = "https://probe-fixture.test") {
  await page.route(`${origin}/**`, async (route) => {
    let name = path.basename(new URL(route.request().url()).pathname);
    if (name === "1.m3u8" || name === "fixture") name = "master.m3u8";
    await route.fulfill({
      body: await readFile(path.resolve("e2e/fixtures/hls", name)),
      headers: {
        "access-control-allow-origin": "*",
        "content-type": name.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : name.endsWith(".vtt")
            ? "text/vtt"
            : "video/mp2t",
      },
    });
  });
}
async function add(
  page: Page,
  title: string,
  url: string,
  privateItem = false,
) {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form.getByRole("textbox", { name: "Media URL", exact: true }).fill(url);
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption(privateItem ? "adult" : "general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill(title);
  await page
    .getByRole("button", { name: `Details for ${title}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Source & playback", exact: true })
    .click();
}
test("checker confirms actual decoded HLS frames, stores bounded evidence and releases video", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/#/settings");
  await add(
    page,
    "Decoded video sample",
    "https://probe-fixture.test/master.m3u8",
  );
  await page.getByRole("button", { name: "Check video", exact: true }).click();
  await expect(
    page.locator('[data-probe-status="video-confirmed"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-probe-status="video-confirmed"]'),
  ).toContainText(/\d+×\d+.*frames/);
  expect(
    await page
      .locator(".probe-video")
      .evaluate((v) => (v as HTMLVideoElement).getAttribute("src")),
  ).toBeNull();
  const cache = await page.evaluate(() =>
    localStorage.getItem("opentv:video-health:v1"),
  );
  expect(cache).toContain("video-confirmed");
  expect(cache).not.toContain("probe-fixture");
  await page
    .getByRole("button", { name: "Report this listing", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/legal$/);
  await expect(
    page.getByRole("link", {
      name: "Open GitHub listing report",
      exact: false,
    }),
  ).toHaveCount(0);
});
test("audio-only HLS and a fake HTTP-200 video are never marked verified video", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("https://fake-video.test/movie.mp4", (route) =>
    route.fulfill({
      status: 200,
      contentType: "video/mp4",
      body: "<html>This is not a video</html>",
    }),
  );
  await page.goto("/#/settings");
  await add(
    page,
    "Audio without video",
    "https://probe-fixture.test/audio.m3u8",
  );
  await page.getByRole("button", { name: "Check video", exact: true }).click();
  await expect(page.locator('[data-probe-status="audio-only"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await add(page, "Fake responding video", "https://fake-video.test/movie.mp4");
  await page.getByRole("button", { name: "Check video", exact: true }).click();
  await expect(page.locator('[data-probe-status="failed"]')).toBeVisible();
  await expect(
    page.locator('[data-probe-status="video-confirmed"]'),
  ).toHaveCount(0);
});
test("private video evidence and report references never enter persistent stores or public issues", async ({
  page,
}) => {
  await fixtures(page, "https://private-probe.test");
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await expect(
    page.getByRole("button", {
      name: "Check public stream sample",
      exact: true,
    }),
  ).toBeDisabled();
  await add(
    page,
    "Private video sample",
    "https://private-probe.test/live/user/password/1.m3u8",
    true,
  );
  await page.getByRole("button", { name: "Check video", exact: true }).click();
  await expect(
    page.locator('[data-probe-status="video-confirmed"]'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:video-health:v1")),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Report this listing", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Open GitHub listing report",
      exact: false,
    }),
  ).toHaveCount(0);
  const stores = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stores).not.toMatch(
    /private-probe|user\/password|Private video sample/,
  );
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(
    page.getByText("Content reference:", { exact: false }),
  ).toHaveCount(0);
});
test("configured relay resolves HTTP playback without contacting the original or persisting access secrets", async ({
  page,
}) => {
  const secret = "test-relay-secret-never-store-this-value";
  let originalRequests = 0;
  await page.route("http://insecure-original.test/**", (route) => {
    originalRequests++;
    return route.abort();
  });
  await fixtures(page, "https://owned-relay.test");
  await page.route("https://owned-relay.test/v1/session", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${secret}`);
    expect(route.request().postDataJSON()).toEqual({
      url: "http://insecure-original.test/live/master.m3u8",
    });
    await route.fulfill({
      json: { playbackUrl: "https://owned-relay.test/v1/resource/fixture" },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/#/settings");
  await settingsTab(page, "This device");
  const relay = page.locator("form").filter({
    has: page.getByRole("button", { name: "Connect relay", exact: true }),
  });
  await relay
    .getByLabel("Relay HTTPS origin", { exact: true })
    .fill("https://owned-relay.test");
  await relay.getByLabel("Relay access secret", { exact: true }).fill(secret);
  await relay
    .getByRole("button", { name: "Connect relay", exact: true })
    .click();
  await settingsTab(page, "Sources");
  await add(
    page,
    "Relayed HTTP fixture",
    "http://insecure-original.test/live/master.m3u8",
  );
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".player-dialog video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.2);
  expect(originalRequests).toBe(0);
  const stores = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  // The relay's address is remembered so reconnecting needs only the secret; the secret
  // itself is never stored.
  expect(stores).not.toContain(secret);
});
test("native media messages support transport and absolute seeking without automatic resume", async ({
  page,
}) => {
  await mockDevice(page);
  await fixtures(page);
  await page.goto("/#/settings");
  await add(
    page,
    "Native public film",
    "https://probe-fixture.test/master.m3u8",
  );
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { deviceMessages: string[] }).deviceMessages
          .map((v) => JSON.parse(v))
          .some(
            (v) =>
              v.type === "media" &&
              v.phase === "playing" &&
              v.title === "Native public film",
          ),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("opentv:seek", { detail: { seconds: 2.5 } }),
    ),
  );
  await expect
    .poll(() =>
      page
        .locator(".player-dialog video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(2.4);
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:suspend")));
  await expect
    .poll(() =>
      page
        .locator(".player-dialog video")
        .evaluate((v) => (v as HTMLVideoElement).paused),
    )
    .toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() =>
      page
        .locator(".player-dialog video")
        .evaluate((v) => (v as HTMLVideoElement).paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close player", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { deviceMessages: string[] }).deviceMessages
          .map((v) => JSON.parse(v))
          .some((v) => v.type === "media" && v.phase === "idle"),
      ),
    )
    .toBe(true);
});
test("native private playback sends privacy protection and redacted system metadata", async ({
  page,
}) => {
  await mockDevice(page);
  await fixtures(page);
  await page.goto("/#/settings");
  await enablePrivateViewing(page);
  await add(
    page,
    "Private native title",
    "https://probe-fixture.test/master.m3u8",
    true,
  );
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { deviceMessages: string[] }).deviceMessages
          .map((v) => JSON.parse(v))
          .some((v) => v.type === "media" && v.phase === "playing"),
      ),
    )
    .toBe(true);
  const events = await page.evaluate(() =>
    (window as Window & { deviceMessages: string[] }).deviceMessages.map((v) =>
      JSON.parse(v),
    ),
  );
  expect(events.some((v) => v.type === "privacy" && v.enabled === true)).toBe(
    true,
  );
  expect(
    events
      .filter((v) => v.type === "media")
      .every((v) => v.title === "Open TV"),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toContain("Private native title");
  expect(
    await page
      .locator(".player-dialog video")
      .evaluate((v) => (v as HTMLVideoElement).disablePictureInPicture),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:suspend")));
  await expect(page.locator(".private-banner")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { deviceMessages: string[] }).deviceMessages
            .map((v) => JSON.parse(v))
            .at(-1)?.enabled,
      ),
    )
    .toBe(false);
});
