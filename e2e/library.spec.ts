import {
  test,
  expect,
  type Page,
  enablePrivateViewing,
  settingsTab,
} from "./viewer-test";
async function addMedia(page: Page, title: string, classification = "general") {
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form
    .getByRole("textbox", { name: "Media URL", exact: true })
    .fill(`https://example.com/${title.replace(/ /g, "-")}.mp4`);
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption(classification);
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
}
async function library(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "My Library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
}
test("personal media edits retain identity and survive cache clearing; removal is reversible", async ({
  page,
}) => {
  await page.goto("/");
  await addMedia(page, "Library fixture");
  await library(page);
  await expect(
    page.getByRole("heading", { name: "Library fixture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save Library fixture", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("opentv:user:v2") || "{}").favorites
            ?.length,
      ),
    )
    .toBe(1);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("opentv:user:v2") || "{}").favorites,
  );
  await page
    .getByRole("button", { name: "Edit Library fixture", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Edited library fixture");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edited library fixture", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edited library fixture", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("opentv:user:v2") || "{}").favorites,
    ),
  ).toEqual(before);
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await settingsTab(page, "Privacy");
  await page
    .getByRole("button", { name: "Clear catalog cache", exact: true })
    .click();
  await page.reload();
  await library(page);
  await expect(
    page.getByRole("heading", { name: "Edited library fixture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove Edited library fixture from personal media",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edited library fixture", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo removal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edited library fixture", exact: true }),
  ).toBeVisible();
});
test("named collections can be created, populated, renamed, and restored", async ({
  page,
}) => {
  await page.goto("/#/library");
  await page
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Collection name", exact: true })
    .fill("Weekend stories");
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse movies", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Big Buck Bunny", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Organize in a collection", exact: true })
    .selectOption({ label: "Weekend stories" });
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "My Library", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Your collections", exact: true })
    .selectOption({ label: "Weekend stories" });
  await expect(
    page.getByRole("heading", { name: "Big Buck Bunny", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New collection name", exact: true })
    .fill("Sunday cinema");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page
    .getByRole("combobox", { name: "Your collections", exact: true })
    .selectOption({ label: "Sunday cinema" });
  await expect(
    page.getByRole("heading", { name: "Big Buck Bunny", exact: true }),
  ).toBeVisible();
});
test("media added and edited while 18+ is shown is kept after hiding it and reloading", async ({
  page,
}) => {
  await page.goto("/");
  await addMedia(page, "Public fixture");
  await enablePrivateViewing(page);
  await addMedia(page, "Added while shown");
  await library(page);
  await page
    .getByRole("button", { name: "Edit Public fixture", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Edited while shown");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
  for (const name of ["Added while shown", "Edited while shown"])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Public fixture", exact: true }),
  ).toHaveCount(0);
});
