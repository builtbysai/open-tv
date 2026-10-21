import { test, expect, enablePrivateViewing, settingsTab } from "./viewer-test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
// Read with fs: Node cannot import JSON from the test runner without an import attribute.
const site = JSON.parse(readFileSync("site.config.json", "utf8")) as {
  url: string;
};
const siteUrl = (path: string) =>
  new URL(path.replace(/^\//, ""), site.url).href;
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { UpdateManifest } from "../src/domain/catalog-updates";
const baseline: UpdateManifest = JSON.parse(
  readFileSync("dist/catalog/update-manifest.json", "utf8"),
);
const UPDATE_KEY = "opentv:public-updates:v1";
const id = "ot-updatetest";
const entry = (title: string) => ({
  id,
  providerId: "open-cinema",
  title,
  type: "live",
  classification: "general",
  genres: ["News"],
  countries: [],
  languages: [],
  availability: "playable",
  rights: { status: "provider-listed" },
  streams: [{ url: "https://update-video.test/master.m3u8", format: "hls" }],
});
function publication(title: string, revision = baseline.revision + 1) {
  const text = JSON.stringify({ version: 1, items: [entry(title)] });
  const sha256 = createHash("sha256").update(text).digest("hex");
  const value: UpdateManifest = {
    ...baseline,
    revision,
    catalogs: baseline.catalogs.map((c) =>
      c.id !== "open-cinema"
        ? c
        : {
            ...c,
            sha256,
            bytes: Buffer.byteLength(text),
            path: `/catalog/releases/open-cinema-${sha256}.json`,
          },
    ),
  };
  return { value, text };
}
async function setup(
  page: Page,
  options: {
    native?: boolean;
    update?: ReturnType<typeof publication>;
    corrupt?: boolean;
  } = {},
) {
  const state = {
    value: options.update?.value || baseline,
    text: options.update?.text || "",
    corrupt: !!options.corrupt,
    manifests: [] as string[],
    files: [] as string[],
  };
  if (options.native)
    await page.route(
      "https://appassets.androidplatform.net/**",
      async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const file = path.resolve(
          "dist",
          "." + (pathname === "/" ? "/index.html" : pathname),
        );
        const type = file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".html")
              ? "text/html"
              : file.endsWith(".json")
                ? "application/json"
                : "image/webp";
        try {
          await route.fulfill({
            body: await readFile(file),
            contentType: type,
          });
        } catch {
          await route.fulfill({ status: 404 });
        }
      },
    );
  await page.route("**/catalog/update-manifest.json", async (route) => {
    state.manifests.push(route.request().url());
    await route.fulfill({
      json: state.value,
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  });
  await page.route("**/catalog/releases/*.json", async (route) => {
    state.files.push(route.request().url());
    await route.fulfill({
      body: state.corrupt ? "corrupt bytes" : state.text,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.route("**/catalog/open-cinema.json", (route) =>
    route.fulfill({ json: { version: 1, items: [entry("Bundled channel")] } }),
  );
  // These tests are about the bundled catalog alone.
  await page.route("**/extension.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route("**/playlists/*.m3u", (route) =>
    route.fulfill({ body: "#EXTM3U\n", contentType: "text/plain" }),
  );
  await page.route("https://update-video.test/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({
      body: await readFile(path.resolve("e2e/fixtures/hls", name)),
      headers: {
        "access-control-allow-origin": "*",
        "content-type": name.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : name.endsWith(".vtt")
            ? "text/vtt"
            : "video/mp2t",
      },
    });
  });
  return state;
}
test("native asset origin receives a public update once and restores its verified catalog offline without reinstalling", async ({
  page,
}) => {
  const state = await setup(page, {
    native: true,
    update: publication("Updated TV channel"),
  });
  await page.goto(
    "https://appassets.androidplatform.net/index.html?tv=1#/live",
  );
  await expect(
    page.getByRole("button", {
      name: "Details for Updated TV channel",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.manifests).toEqual([siteUrl("/catalog/update-manifest.json")]);
  expect(state.files).toHaveLength(1);
  expect(state.files[0]).toMatch(
    new RegExp(
      `^${siteUrl("/catalog/releases/open-cinema-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Details for Updated TV channel",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.files).toHaveLength(1);
  expect(state.manifests).toHaveLength(1);
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await expect(page.locator('[data-update-status="cached"]')).toContainText(
    `Revision ${state.value.revision}`,
  );
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    UPDATE_KEY,
  );
  expect(stored).not.toMatch(
    /update-video|Updated TV channel|password|history/,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("opentv:user:v2")!).session.route,
      ),
    )
    .toBe("settings");
  await page.goto("https://appassets.androidplatform.net/index.html?tv=1");
  await page.getByRole("button", { name: "Browse on this TV" }).click();
  await settingsTab(page, "About");
  await expect(
    page.getByRole("heading", {
      name: "Catalog updates",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.files).toHaveLength(1);
});
test("an accepted restriction stops real HLS playback, removes the listing and survives cache clearing and reload", async ({
  page,
}) => {
  await page.clock.install();
  const state = await setup(page, {
    update: publication("Revocable live channel"),
  });
  await page.goto("/#/live");
  await page
    .getByRole("button", {
      name: "Details for Revocable live channel",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Watch live", exact: true }).click();
  const video = page.locator(".player-stage video");
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.1);
  const element = await video.elementHandle();
  state.value = {
    ...state.value,
    revision: state.value.revision + 1,
    policy: { ...state.value.policy, blockedContentIds: [id] },
  };
  await page.clock.fastForward(31 * 60000);
  await expect(page.locator(".player-dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      element!.evaluate(
        (v) => (v as HTMLVideoElement).paused && !v.getAttribute("src"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", {
      name: "Details for Revocable live channel",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.files).toHaveLength(1); // Policy-only changes do not download unchanged catalogs.
  await page
    .getByRole("button", { name: "Settings and sources", exact: true })
    .click();
  await settingsTab(page, "Privacy");
  await page
    .getByRole("button", { name: "Clear catalog cache", exact: true })
    .click();
  await page.route("**/catalog/update-manifest.json", (route) => route.abort());
  await page.reload();
  await expect(page.locator("[data-update-status]")).toContainText(
    `Revision ${state.value.revision}`,
  );
  await page.getByRole("button", { name: "Live TV", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /Details for (Revocable live|Bundled) channel/,
    }),
  ).toHaveCount(0);
  expect(
    JSON.parse(
      await page.evaluate((key) => localStorage.getItem(key)!, UPDATE_KEY),
    ).manifest.policy.blockedContentIds,
  ).toEqual([id]);
});
test("automatic checks keep running with 18+ shown, pause for native suspend, resume without audio, and reject older policies", async ({
  page,
}) => {
  await page.clock.install();
  const state = await setup(page);
  await page.goto("/?tv=1#/settings");
  await settingsTab(page, "About");
  await expect(page.locator('[data-update-status="current"]')).toBeVisible();
  await enablePrivateViewing(page);
  await page.clock.fastForward(31 * 60000);
  await expect.poll(() => state.manifests.length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:suspend")));
  await page.clock.fastForward(31 * 60000);
  expect(state.manifests).toHaveLength(2);
  state.value = {
    ...state.value,
    revision: baseline.revision + 2,
    policy: { ...state.value.policy, blockedContentIds: [id] },
  };
  await page.evaluate(() => window.dispatchEvent(new Event("opentv:resume")));
  await expect.poll(() => state.manifests.length).toBe(3);
  await expect(page.locator("[data-update-status]")).toContainText(
    `Revision ${state.value.revision}`,
  );
  expect(
    await page
      .locator("video")
      .evaluateAll((videos) =>
        videos.every((v) => (v as HTMLVideoElement).paused),
      ),
  ).toBe(true);
  state.value = baseline;
  await page.clock.fastForward(16000);
  await settingsTab(page, "About");
  await page
    .getByRole("button", { name: "Check catalog updates", exact: true })
    .click();
  await expect(page.locator('[data-update-status="offline"]')).toContainText(
    `Revision ${baseline.revision + 2}`,
  );
});
test("corrupt release bytes use the bundled fallback and a later check retries the same release successfully", async ({
  page,
}) => {
  await page.clock.install();
  const state = await setup(page, {
    update: publication("Verified replacement"),
    corrupt: true,
  });
  await page.goto("/#/settings");
  const row = page.locator(".source-row").filter({
    has: page.getByRole("heading", {
      name: "Blender Open Movies",
      exact: true,
    }),
  });
  await expect(row).toContainText("bundled fallback");
  expect(state.files).toHaveLength(1);
  state.corrupt = false;
  await page.clock.fastForward(16000);
  await settingsTab(page, "About");
  await page
    .getByRole("button", { name: "Check catalog updates", exact: true })
    .click();
  await settingsTab(page, "Sources");
  await expect(row).toContainText("synced");
  await page.getByRole("button", { name: "Live TV", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Details for Verified replacement",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.files).toHaveLength(2);
});
test("cached restrictions apply before catalog display", async ({ page }) => {
  const blocked = {
    ...baseline,
    revision: baseline.revision + 1,
    policy: { ...baseline.policy, blockedProviderIds: ["open-cinema"] },
  };
  await page.addInitScript(
    ({ key, value }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          endpoint: "http://127.0.0.1:4173/catalog/update-manifest.json",
          manifest: value,
        }),
      ),
    { key: UPDATE_KEY, value: blocked },
  );
  const state = await setup(page);
  expect(state.manifests).toHaveLength(0);
  await page.goto("/#/live");
  await expect(
    page.getByRole("button", { name: "Live TV", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Details for Bundled channel",
      exact: true,
    }),
  ).toHaveCount(0);
});
