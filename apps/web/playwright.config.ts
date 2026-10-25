import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { prepareE2EEnvironment } from "./scripts/lib/e2e-environment";
import { repositoryRoot, webRoot } from "./e2e/setup/paths";

const file = process.env.E2E_ENV_FILE;
if (!file) throw new Error("Set E2E_ENV_FILE to a disposable local test environment file.");
const target = prepareE2EEnvironment(
  parseEnv(readFileSync(path.resolve(webRoot, file), "utf8")),
  readFileSync(path.join(repositoryRoot, "supabase/config.toml"), "utf8"),
  process.env,
);
Object.assign(process.env, target.env);

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
    baseURL: target.baseURL,

    /* Collect trace when retrying a failed test */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video is heavy; only keep it on first retry */
    video: "on-first-retry",

    /* Generating auth fixtures and loading workspace-scoped pages can exceed
       the default 30s under concurrent local dev-server load. */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  /* Generous timeout for the first auth-fixture generation pass. */
  timeout: 60_000,

  /* Auth fixture generation runs once before any viewport project. */
  projects: [
    { name: "setup", testMatch: /e2e\/setup\/auth-setup\.ts/ },
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "iPhone 12/13",
      use: { ...devices["iPhone 12"] },
      dependencies: ["setup"],
    },
    {
      name: "Pixel 7",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
    },
    {
      name: "iPad Mini",
      use: { ...devices["iPad Mini"] },
      dependencies: ["setup"],
    },
  ],

  /* Own the server so an existing process cannot supply a different database or providers. */
  webServer: {
    command: `pnpm exec next dev --hostname ${target.hostname} --port ${target.port}`,
    url: target.baseURL,
    env: target.env,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  /* Reset the seeded DB once before the suite starts */
  globalSetup: path.resolve(__dirname, "./e2e/setup/global.ts"),
  globalTeardown: path.resolve(__dirname, "./e2e/setup/teardown.ts"),

  /* Artifacts */
  outputDir: "e2e/test-results",
});
