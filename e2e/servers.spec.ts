import { test, expect, type Page, enablePrivateViewing } from "./viewer-test";
import { readFile } from "node:fs/promises";
async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
}
async function createServer(page: Page, name: string, base: string) {
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  const form = page.getByRole("form", {
    name: "Add media server",
    exact: true,
  });
  await form
    .getByRole("textbox", { name: "Server name", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill(base);
  await form
    .getByRole("combobox", { name: "Server content", exact: true })
    .selectOption("general");
  await form.getByLabel("I am authorized to use this server").check();
  await form
    .getByRole("button", { name: "Create server", exact: true })
    .click();
  await expect(
    page.locator(".server-row").getByRole("heading", { name, exact: true }),
  ).toBeVisible();
}
async function addLinked(
  page: Page,
  title: string,
  name: string,
  type = "movie",
  season = 1,
) {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await form
    .getByRole("combobox", { name: "Playback source", exact: true })
    .selectOption({ label: name });
  await form
    .getByRole("textbox", { name: "Provider title ID", exact: true })
    .fill("tt123");
  await form
    .getByRole("combobox", { name: "Content type", exact: true })
    .selectOption(type);
  if (type !== "movie") {
    await form
      .getByRole("spinbutton", { name: "Season", exact: true })
      .fill(String(season));
    await form
      .getByRole("spinbutton", { name: "Episode", exact: true })
      .fill("1");
  }
  await form
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await form
    .getByRole("textbox", { name: "Languages (comma separated)", exact: true })
    .fill("English, French");
  await form
    .getByRole("spinbutton", { name: "Release year", exact: true })
    .fill("2024");
  await form.getByLabel("I have permission to access this media").check();
  await form.getByRole("button", { name: "Add media", exact: true }).click();
}
async function personal(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "My Library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Personal media", exact: true })
    .click();
}
async function playTitle(page: Page, title: string, url: string) {
  await page
    .getByRole("button", { name: `Details for ${title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect(page.locator(".player-stage iframe")).toHaveAttribute(
    "src",
    url,
  );
  // A server is added on purpose, so its page is not sandboxed.
  await expect(page.locator(".player-stage iframe")).not.toHaveAttribute(
    "sandbox",
    /.*/,
  );
  await page.getByRole("button", { name: "Close player", exact: true }).click();
}
test("server edits and per-title reassignment preserve favorites and metadata across reload", async ({
  page,
}) => {
  await page.route("https://*-server-fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Authorized test player</h1>",
    }),
  );
  await page.goto("/#/settings");
  await createServer(page, "First server", "https://first-server-fixture.test");
  await createServer(
    page,
    "Second server",
    "https://second-server-fixture.test",
  );
  const draftForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add media", exact: true }),
  });
  await draftForm
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Draft linked entry");
  await draftForm
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("general");
  await draftForm
    .getByRole("combobox", { name: "Playback source", exact: true })
    .selectOption({ label: "First server" });
  await draftForm
    .getByRole("textbox", { name: "Provider title ID", exact: true })
    .fill("https://secret.test/title?token=never-store");
  await draftForm
    .getByRole("spinbutton", { name: "Release year", exact: true })
    .fill("2021");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("opentv:user:v2")!).session.drafts
            .media?.year,
      ),
    )
    .toBe(2021);
  expect(
    await page.evaluate(() => localStorage.getItem("opentv:user:v2")),
  ).not.toContain("never-store");
  await draftForm
    .getByRole("textbox", { name: "Provider title ID", exact: true })
    .fill("tt123");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("opentv:user:v2")!).session.drafts
            .media?.providerItemId,
      ),
    )
    .toBe("tt123");
  await page.reload();
  await expect(
    draftForm
      .getByRole("combobox", { name: "Playback source", exact: true })
      .locator("option:checked"),
  ).toHaveText("First server");
  await expect(
    draftForm.getByRole("textbox", { name: "Provider title ID", exact: true }),
  ).toHaveValue("tt123");
  await addLinked(page, "Server film fixture", "First server");
  await personal(page);
  await page
    .getByRole("button", { name: "Save Server film fixture", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("opentv:user:v2")!).favorites.length,
      ),
    )
    .toBe(1);
  const identity = await page.evaluate(
    () => JSON.parse(localStorage.getItem("opentv:user:v2")!).favorites[0],
  );
  await settings(page);
  await page
    .getByRole("button", { name: "Edit server First server", exact: true })
    .click();
  const serverForm = page.getByRole("form", {
    name: "Edit media server",
    exact: true,
  });
  await serverForm
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("https://changed-server-fixture.test");
  await serverForm
    .getByRole("button", { name: "Save server", exact: true })
    .click();
  await personal(page);
  await playTitle(
    page,
    "Server film fixture",
    "https://changed-server-fixture.test/embed/movie/tt123",
  );
  await page
    .getByRole("button", { name: "Edit Server film fixture", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit your media",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Corrected server film");
  await editor
    .getByRole("combobox", { name: "Playback source", exact: true })
    .selectOption({ label: "Second server" });
  await editor
    .getByRole("textbox", { name: "Genres (comma separated)", exact: true })
    .fill("Drama, Independent");
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Remove Corrected server film",
      exact: true,
    }),
  ).toBeVisible();
  // The edit is written to IndexedDB after it shows; wait for that before reloading.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open("opentv-library");
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
              const db = open.result;
              const read = db
                .transaction("library", "readonly")
                .objectStore("library")
                .getAll();
              read.onsuccess = () => {
                db.close();
                resolve(
                  JSON.stringify(read.result).includes("Corrected server film"),
                );
              };
              read.onerror = () => resolve(false);
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Remove Corrected server film",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("opentv:user:v2")!).favorites[0],
    ),
  ).toBe(identity);
  await playTitle(
    page,
    "Corrected server film",
    "https://second-server-fixture.test/embed/movie/tt123",
  );
  const exported = page.waitForEvent("download");
  await settings(page);
  await page
    .getByRole("button", { name: "Export sources", exact: true })
    .click();
  const file = await exported;
  const backup = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(backup.servers).toHaveLength(2);
  expect(backup.servers[0].base).toMatch(/^https:/);
});
test("disconnect, removal, undo and registry restore preserve linked episodes and Specials", async ({
  page,
}) => {
  await page.route("https://episode-server-fixture.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Test episode</h1>" }),
  );
  await page.goto("/#/settings");
  await createServer(
    page,
    "Episode server",
    "https://episode-server-fixture.test",
  );
  await addLinked(page, "Special fixture", "Episode server", "anime", 0);
  await addLinked(page, "Season fixture", "Episode server", "anime", 1);
  await personal(page);
  await page
    .getByRole("button", { name: "Details for Special fixture", exact: true })
    .click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect(page.locator(".player-stage iframe")).toHaveAttribute(
    "src",
    "https://episode-server-fixture.test/embed/tv/tt123/0/1",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".player-stage iframe")).toHaveAttribute(
    "src",
    "https://episode-server-fixture.test/embed/tv/tt123/1/1",
  );
  await page.getByRole("button", { name: "Close player", exact: true }).click();
  await settings(page);
  const row = page.locator(".server-row");
  await row
    .getByRole("button", { name: "Disconnect server", exact: true })
    .click();
  await personal(page);
  await page
    .getByRole("button", { name: "Details for Special fixture", exact: true })
    .click();
  await expect(
    page.getByText("Playback unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Watch now", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await settings(page);
  await row
    .getByRole("button", { name: "Reconnect server", exact: true })
    .click();
  const registry = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("opentv:servers:v1")!),
  );
  await page
    .getByRole("button", { name: "Remove server Episode server", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove server", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo server removal", exact: true })
    .click();
  await expect(row).toHaveCount(1);
  await page
    .getByRole("button", { name: "Remove server Episode server", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove server", exact: true })
    .click();
  await page
    .locator("label.file-input")
    .filter({ hasText: "Import source registry" })
    .locator("input")
    .setInputFiles({
      name: "servers.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...registry, sources: [] })),
    });
  await expect(
    row.getByRole("button", { name: "Reconnect server", exact: true }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: "Reconnect server", exact: true })
    .click();
  await page.reload();
  await personal(page);
  await playTitle(
    page,
    "Special fixture",
    "https://episode-server-fixture.test/embed/tv/tt123/0/1",
  );
  await expect(
    page.getByRole("heading", { name: "Season fixture", exact: true }),
  ).toBeVisible();
});
test("server edits and new servers made while 18+ is shown are saved like any other", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await createServer(
    page,
    "General server",
    "https://general-server-fixture.test",
  );
  await addLinked(page, "General server film", "General server");
  await enablePrivateViewing(page);
  await page
    .getByRole("button", { name: "Edit server General server", exact: true })
    .click();
  await page
    .getByRole("form", { name: "Edit media server", exact: true })
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("https://edited-server-fixture.test");
  await page.getByRole("button", { name: "Save server", exact: true }).click();
  await createServer(
    page,
    "Second server fixture",
    "https://second-server-fixture.test",
  );
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.reload();
  await settings(page);
  await expect(page.locator(".server-row")).toHaveCount(2);
  await expect(page.locator(".server-row .server-address").first()).toHaveText(
    "https://edited-server-fixture.test",
  );
  await personal(page);
  await expect(
    page.getByRole("heading", { name: "General server film", exact: true }),
  ).toBeVisible();
});
test("a click-guarded server absorbs the first click, and a sandboxed one is sandboxed", async ({
  page,
}) => {
  await page.route("https://guard-fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Authorized test player</h1>",
    }),
  );
  await page.goto("/#/settings");
  for (const [name, guard] of [
    ["Guarded server", "click"],
    ["Sandboxed server", "sandbox"],
  ] as const) {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    const form = page.getByRole("form", { name: "Add media server" });
    await form.getByRole("textbox", { name: "Server name" }).fill(name);
    await form
      .getByRole("textbox", { name: "Server address" })
      .fill("https://guard-fixture.test");
    await form.getByLabel("Embed protection").selectOption(guard);
    await form.getByLabel("I am authorized to use this server").check();
    await form.getByRole("button", { name: "Create server" }).click();
    await expect(
      page.locator(".server-row").getByRole("heading", { name }),
    ).toBeVisible();
    await addLinked(page, `${name} title`, name);
    await personal(page);
    await page
      .getByRole("button", { name: `Details for ${name} title` })
      .click();
    await page.getByRole("button", { name: "Watch now", exact: true }).click();
    const frame = page.locator(".player-stage iframe");
    if (guard === "click") {
      await expect(frame).not.toHaveAttribute("sandbox", /.*/);
      await page.getByRole("button", { name: /Click to play/ }).click();
      await expect(
        page.getByRole("button", { name: /Click to play/ }),
      ).toHaveCount(0);
    } else {
      await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);
      await expect(
        page.getByRole("button", { name: /Click to play/ }),
      ).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "Close player", exact: true })
      .click();
    await settings(page);
  }
});
test("a server's last check survives a reload", async ({ page }) => {
  await page.route("https://check-fixture.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "ok" }),
  );
  await page.goto("/#/settings");
  await createServer(page, "Checked server", "https://check-fixture.test");
  const row = page.locator(".server-row").filter({ hasText: "Checked server" });
  await expect(row.getByText(/reachable, checked/)).toBeVisible();
  await page.reload();
  await expect(row.getByText(/reachable, checked/)).toBeVisible();
});
test("a second server with the same name is refused with a clear message", async ({
  page,
}) => {
  await page.route("https://dup-fixture.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "ok" }),
  );
  await page.goto("/#/settings");
  await createServer(page, "Same name", "https://dup-fixture.test");
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  const form = page.getByRole("form", { name: "Add media server" });
  await form.getByRole("textbox", { name: "Server name" }).fill("same NAME");
  await form
    .getByRole("textbox", { name: "Server address" })
    .fill("https://dup-fixture.test");
  await form.getByLabel("I am authorized to use this server").check();
  await form.getByRole("button", { name: "Create server" }).click();
  await expect(form.getByRole("alert")).toContainText("already exists");
  await expect(page.locator(".server-row")).toHaveCount(1);
});
test("an embed that reports an error through postMessage shows its message at once", async ({
  page,
}) => {
  await page.route("https://say-fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>parent.postMessage({source:"opentv",type:"error",message:"Title not found"},"*")</script>`,
    }),
  );
  await page.goto("/#/settings");
  await createServer(page, "Talking server", "https://say-fixture.test");
  await addLinked(page, "Talking title", "Talking server");
  await personal(page);
  await page.getByRole("button", { name: "Details for Talking title" }).click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Title not found");
});
test("an embedded server that speaks Player.js gets Open TV controls that drive it", async ({
  page,
}) => {
  await page.route("https://playerjs-fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>
        let t = 0, paused = false; const subs = new Set();
        const emit = (event) => { if (subs.has(event)) parent.postMessage({ context: "player.js", version: "0.0.10", event, value: { seconds: t, duration: 600 } }, "*"); };
        addEventListener("message", (e) => {
          let m = e.data; if (typeof m === "string") { try { m = JSON.parse(m); } catch { return; } }
          if (m?.context !== "player.js") return;
          if (m.method === "addEventListener") subs.add(m.value);
          if (m.method === "pause") { paused = true; emit("pause"); }
          if (m.method === "play") { paused = false; emit("play"); }
          if (m.method === "setCurrentTime") { t = m.value; emit("timeupdate"); }
        });
        parent.postMessage({ context: "player.js", event: "ready" }, "*");
        setInterval(() => { if (!paused) { t += 1; emit("timeupdate"); } }, 200);
      </script>`,
    }),
  );
  await page.goto("/#/settings");
  await createServer(page, "Driven server", "https://playerjs-fixture.test");
  await addLinked(page, "Driven title", "Driven server");
  await personal(page);
  await page.getByRole("button", { name: "Details for Driven title" }).click();
  await page.getByRole("button", { name: "Watch now", exact: true }).click();
  const dock = page.getByRole("group", { name: "Embedded player controls" });
  await expect(dock).toBeVisible();
  await dock.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    dock.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await dock.getByRole("button", { name: "Forward 10 seconds" }).click();
  await expect(dock.getByLabel("Playback time")).toContainText(
    /0:(1\d|2\d) \/ 10:00/,
  );
  await dock.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    dock.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
});

test("a server with its own address format previews and keeps that format", async ({
  page,
}) => {
  await page.route("https://format-fixture.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "ok" }),
  );
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  const form = page.getByRole("form", { name: "Add media server" });
  await form.getByRole("textbox", { name: "Server name" }).fill("Query server");
  await form
    .getByRole("textbox", { name: "Server address" })
    .fill("https://format-fixture.test");
  await form
    .getByRole("combobox", { name: "Address format" })
    .selectOption({ label: "?tmdb=… query" });
  await expect(form.locator(".server-preview")).toContainText(
    "https://format-fixture.test/embed?tmdb=603",
  );
  await expect(form.locator(".server-preview")).toContainText(
    "https://format-fixture.test/embed?tmdb=1396&season=1&episode=1",
  );
  await form.getByLabel("I am authorized to use this server").check();
  await form.getByRole("button", { name: "Create server" }).click();
  await page.getByRole("button", { name: "Edit server Query server" }).click();
  await expect(
    page.getByRole("combobox", { name: "Address format" }),
  ).toHaveValue("query");
  // A pattern that leaves the server's address is refused.
  await page
    .getByRole("combobox", { name: "Address format" })
    .selectOption("custom");
  const films = page.getByRole("textbox", { name: "Films", exact: true });
  await films.fill("https://elsewhere.example/{id}");
  await page.getByRole("button", { name: "Save server" }).click();
  await expect(page.getByRole("alert")).toContainText("address format");
});
