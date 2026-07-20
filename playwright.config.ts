import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Playwright E2E configuration for soletrade.
 *
 * Targets the local Next.js dev server backed by a seeded local Supabase
 * database. Runs on desktop and mobile viewports so mobile UX changes are
 * covered end-to-end.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: Boolean(process.env.CI),

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI to avoid shared DB contention */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter */
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],

  /* Shared settings for all the projects below */
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",

    /* Collect trace when retrying a failed test */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video is heavy; only keep it on first retry */
    video: "on-first-retry",
  },

  /* Viewport/device projects */
  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iPhone 12/13",
      use: { ...devices["iPhone 12"] },
    },
    {
      name: "Pixel 7",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "iPad Mini",
      use: { ...devices["iPad Mini"] },
    },
  ],

  /* Start the Next.js dev server. Reuse an already-running instance locally. */
  webServer: {
    command: "pnpm dev",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  /* Reset the seeded DB once before the suite starts */
  globalSetup: path.resolve(__dirname, "./e2e/setup/global.ts"),
  globalTeardown: path.resolve(__dirname, "./e2e/setup/teardown.ts"),

  /* Artifacts */
  outputDir: "e2e/test-results",
});
