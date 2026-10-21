import { test, expect } from "./viewer-test";

// A failed stream explains itself in full (wrapped, never cut off or covered by the audio
// controls) and offers the standard actions.
test("a failed radio stream shows its whole explanation and the standard actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.route("https://radio.example/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Silent Station");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://radio.example/stream.mp3");
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption("radio");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Listen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Silent Station" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Watch now|Listen|Play/ })
    .first()
    .click();
  const panel = page.locator(".player-error");
  await expect(
    panel.getByRole("heading", { name: "We couldn’t open this stream" }),
  ).toBeVisible({ timeout: 15000 });
  const actions = panel.locator(".actions button");
  await expect(actions).toHaveText(["Retry", "Try another channel", "Back"]);
  const message = panel.locator("p").first();
  await expect(message).toContainText("check the source.");
  for (const part of [message, ...(await actions.all())]) {
    await part.scrollIntoViewIfNeeded();
    const shown = await part.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
      return {
        inside:
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= innerHeight &&
          r.right <= innerWidth,
        onTop: !!hit && (hit === element || element.contains(hit)),
        clipped: element.scrollWidth > element.clientWidth + 1,
      };
    });
    expect(shown).toEqual({ inside: true, onTop: true, clipped: false });
  }
  await panel.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".player-dialog")).toHaveCount(0);
});
