import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://ai-recipe-murex.vercel.app",
    locale: "ja-JP",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "local",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3000",
        locale: "ja-JP",
      },
      testMatch: "**/app-flow.spec.ts",
    },
    {
      name: "mobile-local",
      use: {
        ...devices["iPhone 14"],
        baseURL: "http://localhost:3000",
        locale: "ja-JP",
      },
      testMatch: "**/app-flow.spec.ts",
    },
  ],
});
