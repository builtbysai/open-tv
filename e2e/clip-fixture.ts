import { expect } from "./viewer-test";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const clip = readFileSync(new URL("./fixtures/clip.webm", import.meta.url));
async function serveClip(page: Page) {
  await page.route("https://video-fixture.test/**", (route) => {
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
export async function addClip(page: Page, title = "Remote clip") {
  const file = title.toLowerCase().replace(/\W+/g, "-");
  await serveClip(page);
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill(`https://video-fixture.test/${file}.webm`);
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.locator(".toast")).toBeVisible();
}
