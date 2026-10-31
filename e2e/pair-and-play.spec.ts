import { expect, test } from "@playwright/test";
import { BRIDGE, frameVideo, pairLink, phonePage, tvPage } from "./helpers";

// The whole product, end to end: a phone sets itself up, pairs with a TV through the relay,
// the setup arrives on the TV, and the phone plays and controls a real <video> in a real
// cross-origin frame through the bridge.
test.setTimeout(120_000);
test("phone sets up, pairs, and remote-controls playback on the TV", async ({ browser }) => {
  const tv = await tvPage(browser, null); // a fresh TV: nothing configured
  const phone = await phonePage(browser);

  // --- TV shows the setup screen with a pairing code
  await expect(tv.page.getByText("Welcome to Open TV")).toBeVisible();
  const link = await pairLink(tv.page);
  expect(link).toContain("#/pair/");

  await phone.page.goto("/#/setup");
  // --- phone: a wrong key is explained, the right one is saved
  await phone.page.getByPlaceholder("API key or read access token").fill("badkey");
  await phone.page.getByRole("button", { name: "Check and save" }).click();
  await expect(phone.page.getByText("TMDB rejected that key")).toBeVisible();
  await phone.page.getByPlaceholder("API key or read access token").fill("goodkey");
  await phone.page.getByRole("button", { name: "Check and save" }).click();
  await expect(phone.page.getByText("Key works and is saved.")).toBeVisible();

  // --- phone: add the server; the test proves the frame speaks the bridge
  await phone.page.getByRole("button", { name: "Add a server" }).click();
  await phone.page.getByPlaceholder("My server").fill("Bridge");
  await phone.page.getByPlaceholder("https://example.com").fill(BRIDGE);
  await expect(phone.page.locator(".preview code").first()).toHaveText(`${BRIDGE}/embed/movie/603`);
  await phone.page.getByRole("button", { name: "Test this server" }).click();
  await expect(phone.page.getByText("The player answered")).toBeVisible({ timeout: 20_000 });
  await phone.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(phone.page.locator(".srv-main b", { hasText: "Bridge" })).toBeVisible();

  // --- phone scans the TV's code
  await phone.page.goto(link);
  await expect(phone.page.getByText("Connecting to your TV")).toBeVisible();
  await expect(phone.page.locator(".tvline.on")).toContainText("connected", { timeout: 20_000 });
  await expect(tv.page.getByText("Phone connected")).toBeVisible();

  // --- the setup made on the phone arrives on the TV (encrypted through the relay)
  await expect(tv.page.locator(".rail h2").first()).toBeVisible({ timeout: 20_000 });
  await expect(tv.page.getByRole("button", { name: "The Matrix" }).first()).toBeVisible();

  // --- phone picks a movie and plays it on the TV
  await phone.page.getByRole("link", { name: "Browse" }).click();
  await phone.page.getByRole("link", { name: "The Matrix" }).first().click();
  await phone.page.getByRole("group", { name: "Where to watch" }).locator("button").nth(1).click();
  await phone.page.getByRole("button", { name: /▶.* on / }).click();
  const frame = tv.page.locator("iframe.embed-frame");
  await expect(frame).toHaveAttribute("src", `${BRIDGE}/embed/movie/603`, { timeout: 15_000 });
  await expect(frame).toHaveAttribute("referrerpolicy", "origin");

  // --- the bridge comes alive; the phone shows it playing
  await phone.page.getByRole("link", { name: "Remote" }).click();
  await expect(phone.page.locator(".now .phase")).toContainText("Playing", { timeout: 20_000 });
  await expect.poll(async () => (await frameVideo(tv.page, 4181)).paused).toBe(false);

  // --- pause and resume from the phone reach the real <video>
  await phone.page.locator(".rb.big").click();
  await expect.poll(async () => (await frameVideo(tv.page, 4181)).paused, { timeout: 10_000 }).toBe(true);
  await expect(phone.page.locator(".now .phase")).toContainText("Paused");
  await phone.page.locator(".rb.big").click();
  await expect.poll(async () => (await frameVideo(tv.page, 4181)).paused, { timeout: 10_000 }).toBe(false);

  // --- seeking by +10 moves the picture
  const before = (await frameVideo(tv.page, 4181)).time;
  await phone.page.getByRole("button", { name: "+10" }).click();
  await expect.poll(async () => (await frameVideo(tv.page, 4181)).time, { timeout: 10_000 }).toBeGreaterThan(before + 8);

  // --- the mock video starts muted, and the phone says so: unmute it, then mute again
  await phone.page.getByRole("button", { name: "Unmute", exact: true }).click();
  await expect.poll(async () => (await frameVideo(tv.page, 4181)).muted).toBe(false);
  await phone.page.getByRole("button", { name: "Mute", exact: true }).click();
  await expect.poll(async () => (await frameVideo(tv.page, 4181)).muted).toBe(true);

  // --- the remote's Back leaves the player and returns the TV to its screen
  await phone.page.locator(".dk.back").click();
  await expect(frame).toHaveCount(0, { timeout: 10_000 });
  await expect(tv.page.locator(".rail h2").first()).toBeVisible();
  await expect(phone.page.locator(".now .phase")).not.toContainText("Playing");

  // --- progress was saved on the TV and synced back to the phone's list of what to continue
  await expect(tv.page.getByText("Continue watching")).toBeVisible({ timeout: 10_000 });
});
