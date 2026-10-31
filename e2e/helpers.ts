import type { Browser, BrowserContext, Page } from "@playwright/test";

export const BRIDGE = "http://localhost:4181";
export const SILENT = "http://localhost:4182";
export const REFUSE = "http://localhost:4183";

type Seed = { key?: string; servers?: { id: string; name: string; base: string; bridge?: string }[] };

// Pre-fills a device's synced document, as if setup had been done earlier.
export async function seed(context: BrowserContext, { key = "goodkey", servers = [{ id: "bridge1", name: "Bridge", base: BRIDGE }] }: Seed = {}) {
  const doc: Record<string, [number, unknown]> = { "cfg:tmdb": [1, key] };
  servers.forEach((s, i) => {
    doc[`srv:${s.id}`] = [1, { ...s, sandbox: false, enabled: true, order: i, bridge: s.bridge ?? "unknown" }];
  });
  await context.addInitScript((value) => {
    if (!localStorage.getItem("otv:doc")) localStorage.setItem("otv:doc", value);
  }, JSON.stringify(doc));
}

export async function tvPage(browser: Browser, options: Seed | null = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  if (options) await seed(context, options);
  const page = await context.newPage();
  await page.goto("/?tv=1");
  return { context, page };
}
export async function phonePage(browser: Browser, options: Seed | null = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  if (options) await seed(context, options);
  const page = await context.newPage();
  await page.goto("/");
  return { context, page };
}

export const pairLink = async (tv: Page) => {
  const qr = tv.locator(".qr[data-text^='http']").first();
  await qr.waitFor({ timeout: 15_000 });
  return (await qr.getAttribute("data-text"))!;
};

// The frame the player is showing, to ask the real <video> what it is doing. The frame may
// still be navigating when this is called, so wait for it.
export const frameVideo = async (tv: Page, port: number) => {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const frame = tv.frames().find((f) => f.url().includes(`:${port}/embed/`));
    if (frame) {
      try {
        return await frame.evaluate(() => {
          const v = document.querySelector("video");
          if (!v) throw new Error("no video yet");
          return { paused: v.paused, time: v.currentTime, muted: v.muted, volume: v.volume, duration: v.duration };
        });
      } catch {
        /* navigating or not ready: try again */
      }
    }
    if (Date.now() > deadline) throw new Error(`no video in a frame on ${port}`);
    await tv.waitForTimeout(150);
  }
};

// Opens a title from the home screen with the remote and starts it (OK, OK), waiting for each
// screen so the second OK cannot land on the first screen.
export const openAndPlay = async (tv: Page, title: string) => {
  await tv.getByRole("button", { name: title }).first().focus();
  await tv.keyboard.press("Enter");
  await tv.locator(".details h1", { hasText: title }).waitFor();
  await tv.waitForFunction(() => document.activeElement?.getAttribute("data-f") === "d:play");
  await tv.keyboard.press("Enter");
};
