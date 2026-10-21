import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = process.argv[2] || "http://127.0.0.1:4173";
const folder = path.resolve("artifacts/design-review");
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
const sizes = [
  ["desktop", 1440, 960, false],
  ["mobile", 390, 844, false],
  ["tablet", 768, 1024, false],
  ["tv-small", 960, 540, true],
  ["tv", 1920, 1080, true],
];
try {
  for (const [device, width, height, tv] of sizes) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: device === "mobile" || device === "tablet",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const entry = `${origin}/${tv ? "?tv=1" : ""}`;
    const save = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const overflow = await page.evaluate(() => {
        const main = document.querySelector(".main-content");
        return (
          document.documentElement.scrollWidth > innerWidth ||
          Boolean(main && main.scrollWidth > main.clientWidth)
        );
      });
      await page.screenshot({
        path: path.join(folder, `${device}-${name}.png`),
      });
      report.push({
        device,
        screen: name,
        width,
        height,
        overflow,
        errors: [...errors],
      });
    };
    for (const route of [
      "home",
      "live",
      "movies",
      "library",
      "search",
      "settings",
      "legal",
    ]) {
      await page.goto(`${entry}#/${route}`, { waitUntil: "domcontentloaded" });
      await page.locator(".app-shell").waitFor();
      if (route === "home")
        await page.locator(".hero-image").evaluate(async (img) => {
          if (!img.complete) await img.decode();
        });
      if (route === "live" || route === "movies")
        await page.locator(".content-card").first().waitFor();
      if (route === "search") {
        await page.getByRole("searchbox").fill("Sintel");
        await page
          .getByRole("heading", { name: "Sintel", exact: true })
          .waitFor();
      }
      if (route === "settings")
        await page
          .getByRole("heading", { name: "Sources", exact: true })
          .waitFor();
      if (route === "legal")
        await page
          .getByRole("heading", { name: "Content reports", exact: true })
          .waitFor();
      await save(route);
    }
    await page.goto(`${entry}#/movies`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Details for Sintel", exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page.locator(".detail-art img").evaluate(async (img) => {
      if (!img.complete) await img.decode();
    });
    await save("detail");
    await page.close();
    const launch = await browser.newPage({
      viewport: { width, height },
      hasTouch: device === "mobile" || device === "tablet",
      reducedMotion: "reduce",
    });
    await launch.goto(entry, { waitUntil: "domcontentloaded" });
    await launch
      .getByRole("heading", { name: "Choose viewing mode", exact: true })
      .waitFor();
    await launch.evaluate(() => document.fonts.ready);
    await launch.screenshot({
      path: path.join(folder, `${device}-launch.png`),
    });
    const overflow = await launch.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    report.push({
      device,
      screen: "launch",
      width,
      height,
      overflow,
      errors: [],
    });
    await launch.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  path.join(folder, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      screens: report.length,
      failures: report.filter((row) => row.overflow || row.errors.length),
      folder,
    },
    null,
    2,
  ),
);
if (report.some((row) => row.overflow || row.errors.length))
  process.exitCode = 1;
