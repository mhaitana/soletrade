import { repositoryRoot } from "./paths";
import { execSync } from "node:child_process";

/**
 * Playwright global teardown.
 *
 * In CI environments we stop the local Supabase stack so the job is clean. In
 * local development we leave it running so subsequent dev work is not disrupted.
 */
async function globalTeardown(): Promise<void> {
  if (!process.env.CI) {
    console.log("[e2e teardown] Running locally — leaving Supabase stack up.");
    return;
  }

  console.log("[e2e teardown] Stopping local Supabase stack...");
  execSync("pnpm db:stop", { stdio: "inherit", cwd: repositoryRoot });
}

export default globalTeardown;
