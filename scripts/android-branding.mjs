import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const font = (
  await readFile(path.join(root, "public/fonts/inter-latin.woff2"))
).toString("base64");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 320, height: 180 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight:100 900; }
    body { margin:0; width:320px; height:180px; background:#0b0d10; color:#f4f5f6; display:flex; align-items:center; justify-content:center; flex-direction:column; font-family:Inter,sans-serif; }
    .brand { display:flex; align-items:center; gap:12px; font-size:36px; font-weight:720; letter-spacing:-1.5px; }
    .tv { font-weight:450; margin-left:4px; }
    small { color:#a5acb6; font-size:13px; margin-top:12px; }
  </style><div class="brand"><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M15 11 29 20 15 29Z" fill="currentColor"/></svg><span>open<span class="tv">tv</span></span></div><small>Preview</small>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(
      root,
      "android/app/src/main/res/drawable-xhdpi/tv_banner.png",
    ),
  });
} finally {
  await browser.close();
}
