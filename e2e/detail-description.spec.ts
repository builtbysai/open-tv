import { test, expect } from "./viewer-test";

test("a long description opens short at a word boundary and expands on More", async ({
  page,
}) => {
  const sentence =
    "An extraordinarily meandering description that keeps going well beyond what fits. ";
  const description = sentence.repeat(8).trim();
  await page.goto("/#/settings");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Wordy Tone");
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill("https://audio.example/wordy.wav");
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption("audio");
  await form
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(description);
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Listen", exact: true })
    .click();
  await page.getByRole("button", { name: "Details for Wordy Tone" }).click();
  const text = page.getByRole("dialog").locator("p.description");
  const more = text.getByRole("button", { name: "More" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const short = (await text.textContent())!.replace(/\s*More$/, "");
  expect(short.endsWith("…")).toBe(true);
  // Every word shown is whole.
  const words = new Set(
    description.split(/\s+/).map((w) => w.replace(/\W+$/, "")),
  );
  for (const word of short.replace(/…$/, "").split(/\s+/))
    expect(words.has(word.replace(/\W+$/, ""))).toBe(true);
  await more.click();
  await expect(text).toContainText(description);
  await expect(text.getByRole("button", { name: "Less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
