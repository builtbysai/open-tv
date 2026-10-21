import { test, expect, settingsTab } from "./viewer-test";
import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";

// Play on TV end to end: a phone and a TV in two separate browser profiles, talking
// through a local control relay (`npm run dev` in control/, with ALLOWED_ORIGINS="*") and
// a build made with VITE_CONTROL_RELAY=ws://127.0.0.1:8787. Skipped when either is absent.
const RELAY = "http://127.0.0.1:8787/health";
const clip = readFileSync(new URL("./fixtures/clip.webm", import.meta.url));

async function prepare(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("opentv:onboarding:v1")) {
        localStorage.setItem("opentv:onboarding:v1", "done");
        localStorage.setItem("opentv:setup-reminder-hidden:v1", "1");
      }
    } catch {
      /* Storage unavailable. */
    }
  });
  await context.route("https://video-fixture.test/**", (route) => {
    const range = route.request().headers()["range"];
    const headers = {
      "content-type": "video/webm",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    };
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)!;
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : clip.length - 1;
      return route.fulfill({
        status: 206,
        body: clip.subarray(start, end + 1),
        headers: {
          ...headers,
          "content-range": `bytes ${start}-${end}/${clip.length}`,
        },
      });
    }
    return route.fulfill({ status: 200, body: clip, headers });
  });
}
const tvVideo = (tv: Page) => tv.locator("dialog.player-dialog video");

test("pair once, Play on TV, drive it from the phone, survive a TV restart, and revoke", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const relayUp = await fetch(RELAY).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!relayUp, "No local control relay running");

  const tvContext = await browser.newContext({
    viewport: { width: 960, height: 540 },
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 420, height: 860 },
  });
  await prepare(tvContext);
  await prepare(phoneContext);
  const tv = await tvContext.newPage();
  const phone = await phoneContext.newPage();

  // The TV's idle screen offers a pairing code once it reaches the relay.
  await tv.goto("/?tv=1");
  await expect(
    tv.getByRole("button", { name: "Browse on this TV" }),
  ).toBeVisible();
  test.skip(
    (await tv.getByRole("heading", { level: 1 }).innerText()) ===
      "Set up from your phone",
    "This build has no control relay (VITE_CONTROL_RELAY)",
  );
  const reached = await tv
    .getByText(/Not paired|connected|waiting for your phone/)
    .first()
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  test.skip(
    !reached,
    "This build's control relay can't be reached (build with VITE_CONTROL_RELAY=ws://127.0.0.1:8787)",
  );
  await expect(tv.getByText("Not paired")).toBeVisible({ timeout: 15000 });
  const qr = tv.getByRole("img", { name: /QR code to pair/ });
  await expect(qr).toHaveAttribute("data-value", /&c=/);
  const link = new URL((await qr.getAttribute("data-value"))!);

  // The phone opens the code's link and is paired.
  await phone.goto(`/${link.hash}`);
  await expect(
    phone.getByText(/Paired\. This phone is now your TV/),
  ).toBeVisible();

  // A clip added on the phone (the TV doesn't have it) plays on the TV.
  await phone.goto("/#/settings");
  const form = phone.locator("form").filter({
    has: phone.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Remote clip");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://video-fixture.test/remote.webm");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(tv.getByText(/connected/)).toBeVisible();
  await phone.goto("/#/library");
  await phone
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await phone
    .getByRole("button", { name: "Details for Remote clip", exact: true })
    .click();
  await phone.getByRole("button", { name: /^Play on / }).click();

  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.5);
  // It keeps playing: nothing on the TV side pauses what the phone started.
  await tv.waitForTimeout(1500);
  expect(await tvVideo(tv).evaluate((v: HTMLVideoElement) => v.paused)).toBe(
    false,
  );

  // The phone is the remote now.
  const bar = phone.getByRole("region", { name: /^Playing on / });
  await expect(bar.getByText("Remote clip")).toBeVisible();
  await bar.getByRole("button", { name: "Pause on TV" }).click();
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await expect(bar.getByRole("button", { name: "Play on TV" })).toBeVisible();
  await bar.getByRole("button", { name: "Play on TV" }).click();
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  // The phone's clock follows the TV's to within about a second.
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(3);
  const shown = async () => {
    const [m, s] = (await bar.locator(".remote-time span").first().innerText())
      .split(":")
      .map(Number);
    return m * 60 + s;
  };
  const tvTime = await tvVideo(tv).evaluate(
    (v: HTMLVideoElement) => v.currentTime,
  );
  expect(Math.abs((await shown()) - tvTime)).toBeLessThan(1.6);
  // Seeking from the phone moves the TV.
  const seek = bar.getByRole("slider", { name: "Seek on TV" });
  await seek.focus();
  await phone.keyboard.press("Home");
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(2);
  await bar.getByRole("button", { name: "Stop on TV" }).click();
  await expect(tv.locator("dialog.player-dialog")).toHaveCount(0);
  await expect(bar).toHaveCount(0);

  // The TV restarts: the phone finds it again without pairing.
  await tv.reload();
  await expect(tv.getByText(/connected/)).toBeVisible({ timeout: 15000 });
  await phone
    .getByRole("button", { name: "Details for Remote clip", exact: true })
    .click();
  await phone.getByRole("button", { name: /^Play on / }).click();
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.3);
  await phone
    .getByRole("region", { name: /^Playing on / })
    .getByRole("button", { name: "Stop on TV" })
    .click();
  await expect(tv.locator("dialog.player-dialog")).toHaveCount(0);

  // Removing the TV on the phone unpairs it at once on the TV.
  await phone.goto("/#/settings");
  await settingsTab(phone, "This device");
  await phone
    .locator("#settings-tvs")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(tv.getByText("Not paired")).toBeVisible();
  await expect(phone.locator("#settings-tvs li")).toHaveCount(0);
  await tvContext.close();
  await phoneContext.close();
});

test("channels from the phone step on the TV, by phone and by the TV's channel rocker, and Back returns to idle", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const relayUp = await fetch(RELAY).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!relayUp, "No local control relay running");
  const tvContext = await browser.newContext({
    viewport: { width: 960, height: 540 },
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 420, height: 860 },
  });
  await prepare(tvContext);
  await prepare(phoneContext);
  await phoneContext.route("https://channels-fixture.test/list.m3u", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: [
        "#EXTM3U",
        '#EXTINF:-1 group-title="Test",Alpha Channel',
        "https://video-fixture.test/live/alpha",
        '#EXTINF:-1 group-title="Test",Bravo Channel',
        "https://video-fixture.test/live/bravo",
        '#EXTINF:-1 group-title="Test",Charlie Channel',
        "https://video-fixture.test/live/charlie",
      ].join("\n"),
    }),
  );
  const tv = await tvContext.newPage();
  const phone = await phoneContext.newPage();
  await tv.goto("/?tv=1");
  await expect(
    tv.getByRole("button", { name: "Browse on this TV" }),
  ).toBeVisible();
  test.skip(
    (await tv.getByRole("heading", { level: 1 }).innerText()) ===
      "Set up from your phone",
    "This build has no control relay (VITE_CONTROL_RELAY)",
  );
  const reached = await tv
    .getByText(/Not paired|connected|waiting for your phone/)
    .first()
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  test.skip(
    !reached,
    "This build's control relay can't be reached (build with VITE_CONTROL_RELAY=ws://127.0.0.1:8787)",
  );
  const qr = tv.getByRole("img", { name: /QR code to pair/ });
  await expect(qr).toHaveAttribute("data-value", /&c=/, { timeout: 15000 });
  const link = new URL((await qr.getAttribute("data-value"))!);
  await phone.goto(`/${link.hash}`);
  await expect(phone.getByText(/Paired\. This phone/)).toBeVisible();
  await phone.goto("/#/settings");
  const form = phone.locator("form").filter({
    has: phone.getByRole("button", { name: "Connect playlist", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Test channels");
  await form
    .getByRole("textbox", { name: "Playlist URL", exact: true })
    .fill("https://channels-fixture.test/list.m3u");
  await form
    .getByRole("button", { name: "Connect playlist", exact: true })
    .click();
  await expect(phone.getByText(/3 entr/).first()).toBeVisible();
  await phone.goto("/#/live");
  await phone
    .getByRole("button", { name: "Details for Alpha Channel", exact: true })
    .first()
    .click();
  await phone.getByRole("button", { name: /^Play on / }).click();
  const title = tv.locator("dialog.player-dialog h2");
  await expect(title).toHaveText("Alpha Channel", { timeout: 15000 });
  // Next from the phone.
  const bar = phone.getByRole("region", { name: /^Playing on / });
  await bar.getByRole("button", { name: "Next on TV" }).click();
  await expect(title).toHaveText("Bravo Channel");
  await expect(bar.getByText("Bravo Channel")).toBeVisible();
  // The TV's own channel rocker (the host sends it as a media key).
  await tv.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "MediaTrackNext",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(title).toHaveText("Charlie Channel");
  await bar.getByRole("button", { name: "Previous on TV" }).click();
  await expect(title).toHaveText("Bravo Channel");
  // Back in the TV's player returns to its idle screen, once.
  await tv.keyboard.press("Escape");
  await expect(tv.locator("dialog.player-dialog")).toHaveCount(0);
  await expect(
    tv.getByRole("button", { name: "Browse on this TV" }),
  ).toBeVisible();
  await tvContext.close();
  await phoneContext.close();
});

test("hand a title over to the TV and back, keep the place, turn the volume, and use the direct link", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const relayUp = await fetch(RELAY).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!relayUp, "No local control relay running");
  const tvContext = await browser.newContext({
    viewport: { width: 960, height: 540 },
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 1100, height: 860 },
  });
  await prepare(tvContext);
  await prepare(phoneContext);
  const tv = await tvContext.newPage();
  const phone = await phoneContext.newPage();
  await tv.goto("/?tv=1");
  await expect(
    tv.getByRole("button", { name: "Browse on this TV" }),
  ).toBeVisible();
  test.skip(
    (await tv.getByRole("heading", { level: 1 }).innerText()) ===
      "Set up from your phone",
    "This build has no control relay (VITE_CONTROL_RELAY)",
  );
  const reached = await tv
    .getByText(/Not paired|connected|waiting for your phone/)
    .first()
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  test.skip(
    !reached,
    "This build's control relay can't be reached (build with VITE_CONTROL_RELAY=ws://127.0.0.1:8787)",
  );
  const qr = tv.getByRole("img", { name: /QR code to pair/ });
  await expect(qr).toHaveAttribute("data-value", /&c=/, { timeout: 15000 });
  await phone.goto(`/${new URL((await qr.getAttribute("data-value"))!).hash}`);
  await expect(phone.getByText(/Paired\. This phone/)).toBeVisible();
  await phone.goto("/#/settings");
  const form = phone.locator("form").filter({
    has: phone.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Handoff clip");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://video-fixture.test/handoff.webm");
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(tv.getByText(/connected/)).toBeVisible({ timeout: 15000 });

  // Watch on the phone first, then move it to the TV mid-way.
  await phone.goto("/#/library");
  await phone
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await phone
    .getByRole("button", { name: "Details for Handoff clip", exact: true })
    .click();
  await phone.getByRole("button", { name: "Play here", exact: true }).click();
  const phoneVideo = phone.locator("dialog.player-dialog video");
  await expect
    .poll(() => phoneVideo.evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(7);
  await phone.getByRole("button", { name: /^Move to / }).click();
  await expect(phone.locator("dialog.player-dialog")).toHaveCount(0);
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(6);

  // The phone's remote turns the TV's volume (in a browser, the player's).
  const bar = phone.getByRole("region", { name: /^Playing on / });
  const before = await tvVideo(tv).evaluate((v: HTMLVideoElement) => v.volume);
  await bar.getByRole("button", { name: "TV volume down" }).click();
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.volume))
    .toBeLessThan(before);

  // The direct link on the same network opens (both pages are on this machine).
  await expect(bar).toHaveAttribute("data-link", "lan", { timeout: 15000 });
  await bar.getByRole("button", { name: "Pause on TV" }).click();
  await expect
    .poll(() => tvVideo(tv).evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);

  // Carry on here, from where the TV was.
  const tvAt = await tvVideo(tv).evaluate(
    (v: HTMLVideoElement) => v.currentTime,
  );
  await bar.getByRole("button", { name: "Continue on this device" }).click();
  await expect(tv.locator("dialog.player-dialog")).toHaveCount(0);
  await expect
    .poll(() => phoneVideo.evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(tvAt - 2);
  await phone
    .locator("dialog.player-dialog")
    .getByRole("button", { name: "Close player" })
    .click();

  // "Playing on TV" sends Play to the TV from anywhere on the phone.
  const target = phone.getByRole("button", {
    name: /Play on this device|Playing on/,
  });
  await target.click();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await phone.reload();
  await expect(
    phone.getByRole("button", { name: /Playing on/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await tvContext.close();
  await phoneContext.close();
});
