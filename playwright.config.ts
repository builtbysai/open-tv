import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    // Point at a specific Chrome/Chromium when the bundled one is not installed.
    launchOptions: { executablePath: process.env.PW_CHROME || undefined },
  },
  webServer: {
    command: "tsx e2e/harness.ts",
    url: "http://localhost:4173/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
