import { test, expect } from "./viewer-test";
// A short 440 Hz tone as a WAV file, which every browser build can decode.
function tone(seconds = 6, rate = 8000): Buffer {
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
test("audio you add appears in Audio and plays with a visualizer", async ({
  page,
}) => {
  await page.route("https://audio.example/tone.wav", (route) =>
    route.fulfill({
      body: tone(),
      headers: {
        "content-type": "audio/wav",
        "access-control-allow-origin": "*",
      },
    }),
  );
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Fixture Tone");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://audio.example/tone.wav");
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption("audio");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Listen", exact: true })
    .click();
  await page.getByRole("button", { name: "Details for Fixture Tone" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Watch now|Listen|Play/ })
    .first()
    .click();
  const stage = page.locator(".audio-stage");
  await expect(stage).toBeVisible();
  await expect(stage.locator("canvas.visualizer")).toBeVisible();
  await expect(
    stage.getByRole("heading", { name: "Fixture Tone" }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      {
        timeout: 10000,
      },
    )
    .toBeGreaterThan(0.3);
  await stage.getByRole("button", { name: "Pause audio" }).click();
  await expect(stage.getByRole("button", { name: "Play audio" })).toBeVisible();
  const mode = stage.getByRole("button", { name: /Bars|Wave|Rings/ });
  const before = await mode.textContent();
  await mode.click();
  expect(await mode.textContent()).not.toBe(before);
});
test("audio keeps playing in a mini-player while you browse", async ({
  page,
}) => {
  await page.route("https://audio.example/tone.wav", (route) =>
    route.fulfill({
      body: tone(20),
      headers: {
        "content-type": "audio/wav",
        "access-control-allow-origin": "*",
      },
    }),
  );
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Dock Tone");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://audio.example/tone.wav");
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption("audio");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Listen", exact: true })
    .click();
  await page.getByRole("button", { name: "Details for Dock Tone" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Watch now|Listen|Play/ })
    .first()
    .click();
  const stage = page.locator(".audio-stage");
  await expect(stage).toBeVisible();
  await stage.getByRole("button", { name: "Minimize" }).click();
  const mini = page.getByRole("region", { name: "Now playing" });
  await expect(mini).toBeVisible();
  await expect(stage).toBeHidden();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(mini).toBeVisible();
  const time = () =>
    page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime);
  const before = await time();
  await expect.poll(time, { timeout: 8000 }).toBeGreaterThan(before + 0.5);
  await mini.getByRole("button", { name: "Pause audio" }).click();
  await expect(mini.getByRole("button", { name: "Play audio" })).toBeVisible();
  await mini.getByRole("button", { name: "Expand player" }).click();
  await expect(stage).toBeVisible();
  await expect(mini).toHaveCount(0);
  await stage.getByRole("button", { name: "Minimize" }).click();
  await mini.getByRole("button", { name: "Stop and close player" }).click();
  await expect(mini).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
});
async function addTone(
  page: import("@playwright/test").Page,
  title: string,
  file: string,
) {
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill(`https://audio.example/${file}.wav`);
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption("audio");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
}
test("a queue plays before the list, and played audio is listed on Home", async ({
  page,
}) => {
  await page.route("https://audio.example/*.wav", (route) =>
    route.fulfill({
      body: tone(20),
      headers: {
        "content-type": "audio/wav",
        "access-control-allow-origin": "*",
      },
    }),
  );
  await addTone(page, "Queue One", "one");
  await addTone(page, "Queue Two", "two");
  await page.goto("/#/audio");
  await page.getByRole("button", { name: "Details for Queue Two" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add to queue" })
    .click();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Details for Queue One" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Listen", exact: true })
    .click();
  const stage = page.locator(".audio-stage");
  await expect(stage.getByRole("heading", { name: "Queue One" })).toBeVisible();
  await expect(stage.getByText("Up next · Queue Two")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(stage.getByRole("heading", { name: "Queue Two" })).toBeVisible();
  await expect(stage.getByText("Up next")).toHaveCount(0);
  await page.getByRole("button", { name: "Close player" }).click();
  await page.goto("/#/home");
  await expect(
    page.getByRole("region", { name: "Listen again" }),
  ).toBeVisible();
});
