import { test, expect } from "./viewer-test";
import { mockRelay } from "./relay-mock";
test("a phone sends setup data to the TV through an encrypted code", async ({
  page,
  context,
}) => {
  await mockRelay(context);
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "Profiles & data", exact: true }).click();
  const qr = page.getByRole("img", { name: "QR code for phone setup" });
  await expect(qr).toBeVisible();
  const link = (await qr.getAttribute("data-value"))!;
  expect(link).toMatch(/#\/pair\?r=[\w-]+&k=[\w-]{43}$/);
  const phone = await context.newPage();
  await phone.goto(link);
  await phone.reload();
  await expect(
    phone.getByRole("heading", { name: "Send to your TV" }),
  ).toBeVisible();
  await phone
    .getByLabel("Playlist URLs")
    .fill(
      "https://iptv.example.com/channels.m3u\nhttps://other.example.org/live.m3u8",
    );
  await phone.getByLabel("Classification").selectOption("general");
  await phone
    .getByLabel("API key or read access token")
    .fill("abcdef0123456789abcdef0123456789");
  await phone.getByRole("button", { name: "Send to TV" }).click();
  await expect(phone.getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Received from your phone" }),
  ).toBeVisible();
  await expect(page.getByText("2 playlists")).toBeVisible();
  await expect(page.getByText("TMDB key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported from your phone.")).toBeVisible();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(page.getByText("iptv.example.com")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:tmdb-key:v1")),
  ).toBe("abcdef0123456789abcdef0123456789");
});
test("a phone link with the wrong key is ignored by the TV", async ({
  page,
  context,
}) => {
  await mockRelay(context);
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "Profiles & data", exact: true }).click();
  const link = (await page
    .getByRole("img", { name: "QR code for phone setup" })
    .getAttribute("data-value"))!;
  const phone = await context.newPage();
  const forged = link.replace(/&k=[\w-]+$/, "&k=" + "A".repeat(43));
  await phone.goto(forged);
  await phone.reload();
  await phone
    .getByLabel("Playlist URLs")
    .fill("https://evil.example.com/x.m3u");
  await phone.getByRole("button", { name: "Send to TV" }).click();
  await expect(phone.getByRole("heading", { name: "Sent" })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(
    page.getByRole("heading", { name: "Received from your phone" }),
  ).toHaveCount(0);
});
