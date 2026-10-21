import { test, expect } from "./viewer-test";
// A 90-second tone: positions are kept for media longer than a minute.
function tone(seconds = 90, rate = 8000): Buffer {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 9000),
      44 + i * 2,
    );
  return buffer;
}

test("after a reload the track comes back in the mini player, paused where it was", async ({
  page,
}) => {
  const body = tone();
  await page.route("https://audio.example/long.wav", (route) => {
    const range = route.request().headers()["range"];
    const headers = {
      "content-type": "audio/wav",
      "access-control-allow-origin": "*",
      "accept-ranges": "bytes",
    };
    if (!range) return route.fulfill({ body, headers });
    const [, from, to] = /bytes=(\d+)-(\d*)/.exec(range)!;
    const start = Number(from),
      end = to ? Math.min(Number(to), body.length - 1) : body.length - 1;
    return route.fulfill({
      status: 206,
      body: body.subarray(start, end + 1),
      headers: {
        ...headers,
        "content-range": `bytes ${start}-${end}/${body.length}`,
      },
    });
  });
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Long Tone");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://audio.example/long.wav");
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption("audio");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Listen", exact: true })
    .click();
  await page.getByRole("button", { name: "Details for Long Tone" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Watch now|Listen|Play/ })
    .first()
    .click();
  const media = page.locator("video");
  const time = () => media.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(time, { timeout: 10000 }).toBeGreaterThan(0.2);
  await media.evaluate((v: HTMLVideoElement) => (v.currentTime = 30));
  await expect.poll(time).toBeGreaterThan(30.5);
  await page.reload();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini).toBeVisible({ timeout: 15000 });
  await expect(mini).toContainText("Long Tone");
  await expect(mini.getByRole("button", { name: "Play audio" })).toBeVisible();
  await expect.poll(time, { timeout: 10000 }).toBeGreaterThan(25);
  expect(await time()).toBeLessThan(40);
  expect(await media.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  // One tap continues.
  await mini.getByRole("button", { name: "Play audio" }).click();
  const before = await time();
  await expect.poll(time, { timeout: 8000 }).toBeGreaterThan(before + 0.5);
});
