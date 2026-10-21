import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  // Playwright's bundled Chromium cannot decode H.264, so CI sets PW_CHANNEL=chrome to run
  // the playback specs in a real Chrome.
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", channel: process.env.PW_CHANNEL },
    },
  ],
});
