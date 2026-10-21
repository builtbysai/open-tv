import { test, expect, settingsTab } from "./viewer-test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

// The app on an HTTPS origin, where the browser blocks plain-HTTP media for real.
const ORIGIN = "https://opentv.test";
const clip = readFileSync(new URL("./fixtures/clip.webm", import.meta.url));
async function serveApp(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const file = path.resolve(
      "dist",
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    const type = file.endsWith(".js")
      ? "application/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".json")
            ? "application/json"
            : file.endsWith(".m3u")
              ? "audio/x-mpegurl"
              : "application/octet-stream";
    try {
      await route.fulfill({ body: await readFile(file), contentType: type });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}
function clipResponse(range?: string) {
  const headers = {
    "content-type": "video/webm",
    "accept-ranges": "bytes",
    "access-control-allow-origin": "*",
  };
  if (!range) return { status: 200, body: clip, headers };
  const m = /bytes=(\d+)-(\d*)/.exec(range)!;
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), clip.length - 1) : clip.length - 1;
  return {
    status: 206,
    body: clip.subarray(start, end + 1),
    headers: {
      ...headers,
      "content-range": `bytes ${start}-${end}/${clip.length}`,
    },
  };
}
async function addMedia(page: Page, title: string, url: string) {
  await page.goto(`${ORIGIN}/#/settings`);
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form.getByRole("textbox", { name: "Media URL", exact: true }).fill(url);
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.locator(".toast")).toBeVisible();
}
async function open(page: Page, title: string) {
  await page.goto(`${ORIGIN}/#/library`);
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Details for ${title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
}
const video = (page: Page) => page.locator("dialog.player-dialog video");

test("an HTTP address with a working HTTPS twin plays through it, and the route is remembered across reloads", async ({
  page,
}) => {
  await serveApp(page);
  let plainHits = 0;
  await page.route("http://twin.test/**", (route) => {
    plainHits++;
    return route.abort();
  });
  await page.route("https://twin.test/**", (route) =>
    route.fulfill(clipResponse(route.request().headers()["range"])),
  );
  await addMedia(page, "Twin clip", "http://twin.test/clip.webm");
  await open(page, "Twin clip");
  await expect
    .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.3);
  expect(
    await video(page).evaluate((v: HTMLVideoElement) => v.currentSrc),
  ).toBe("https://twin.test/clip.webm");
  expect(plainHits).toBe(0);
  await page.goto(`${ORIGIN}/#/settings`);
  await page.reload();
  await settingsTab(page, "This device");
  const routes = page.locator(".remembered-routes");
  await routes.locator("summary").click();
  await expect(routes).toContainText("twin.test");
  await expect(routes).toContainText("the address's https version");
});

test("a bare-IP HTTP stream without a relay fails fast with the reason; with a relay it plays through the relay", async ({
  page,
}) => {
  await serveApp(page);
  let ipHits = 0;
  await page.route("http://10.9.8.7/**", (route) => {
    ipHits++;
    return route.abort();
  });
  await page.route("https://10.9.8.7/**", (route) => {
    ipHits++;
    return route.abort();
  });
  await addMedia(page, "IP clip", "http://10.9.8.7/clip.webm");
  const started = Date.now();
  await open(page, "IP clip");
  await expect(page.getByRole("alert")).toContainText("bare IP address", {
    timeout: 5000,
  });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(ipHits).toBe(0);

  await page
    .locator("dialog.player-dialog")
    .getByRole("button", { name: "Close player" })
    .click();
  // Now with a relay of your own.
  const sessions: string[] = [];
  await page.route("https://relay.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/session") {
      sessions.push(JSON.parse(route.request().postData() || "{}").url);
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: { playbackUrl: "https://relay.test/v1/resource/sealed" },
      });
    }
    return route.fulfill(clipResponse(route.request().headers()["range"]));
  });
  await page.goto(`${ORIGIN}/#/settings`);
  await settingsTab(page, "This device");
  await page.getByLabel("Relay HTTPS origin").fill("https://relay.test");
  await page.getByLabel("Relay access secret").fill("x".repeat(40));
  await page.getByRole("button", { name: "Connect relay" }).click();
  await expect(page.getByText(/Relay connected/).first()).toBeVisible();
  await page.getByRole("button", { name: "My Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for IP clip", exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect
    .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.3);
  expect(sessions).toEqual(["http://10.9.8.7/clip.webm"]);
  expect(ipHits).toBe(0);
});

test("an HTTPS playlist with HTTP segments is treated as HTTP and sent to the relay", async ({
  page,
}) => {
  await serveApp(page);
  await page.route("https://mixed.test/master.m3u8", (route) =>
    route.fulfill({
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "access-control-allow-origin": "*",
      },
      body: "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nhttp://segments.test/1.ts\n#EXT-X-ENDLIST\n",
    }),
  );
  await addMedia(page, "Mixed playlist", "https://mixed.test/master.m3u8");
  await open(page, "Mixed playlist");
  await expect(page.getByRole("alert")).toContainText(
    "loads its video over plain HTTP",
  );
  const sessions: string[] = [];
  await page.route("https://relay.test/v1/session", async (route) => {
    sessions.push(JSON.parse(route.request().postData() || "{}").url);
    return route.fulfill({ status: 403 });
  });
  await page
    .locator("dialog.player-dialog")
    .getByRole("button", { name: "Close player" })
    .click();
  await page.goto(`${ORIGIN}/#/settings`);
  await settingsTab(page, "This device");
  await page.getByLabel("Relay HTTPS origin").fill("https://relay.test");
  await page.getByLabel("Relay access secret").fill("x".repeat(40));
  await page.getByRole("button", { name: "Connect relay" }).click();
  await page.getByRole("button", { name: "My Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Mixed playlist", exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  // The relay was asked for the playlist; it refused, and that is what you're told.
  await expect(page.getByRole("alert")).toContainText(
    "relay could not authorize",
  );
  expect(sessions).toEqual(["https://mixed.test/master.m3u8"]);
});

test("when the remembered route's server goes away, the resolver runs again and reports the block", async ({
  page,
}) => {
  await serveApp(page);
  let twinUp = true;
  await page.route("https://gone.test/**", (route) =>
    twinUp
      ? route.fulfill(clipResponse(route.request().headers()["range"]))
      : route.fulfill({ status: 503 }),
  );
  await addMedia(page, "Gone clip", "http://gone.test/clip.webm");
  await open(page, "Gone clip");
  await expect
    .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.3);
  await page
    .locator("dialog.player-dialog")
    .getByRole("button", { name: "Close player" })
    .click();
  twinUp = false;
  await page.reload();
  await open(page, "Gone clip");
  await expect(page.getByRole("alert")).toContainText(
    "Its HTTPS address did not answer",
    {
      timeout: 30000,
    },
  );
  const remembered = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("opentv:transport-routes:v1") || "{}"),
  );
  expect(remembered["gone.test"]).toBeUndefined();
});
