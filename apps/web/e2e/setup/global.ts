import { repositoryRoot } from "../../src/testing/paths";
import { execSync } from "node:child_process";

/**
 * Playwright global setup.
 *
 * Ensures the local Supabase stack is running and resets the database with
 * seed data once before the E2E suite starts. This gives every spec a known,
 * deterministic world (seeded users, workspaces, invoices, quotes, etc.).
 */
async function globalSetup(): Promise<void> {
  if (process.env.E2E_ALLOW_RESET !== "1") {
    throw new Error(
      "E2E resets Supabase. Run only against disposable local data with E2E_ALLOW_RESET=1.",
    );
  }
  const isSupabaseRunning = checkSupabaseRunning();

  if (!isSupabaseRunning) {
    console.log("[e2e setup] Local Supabase is not running. Starting it...");
    execSync("pnpm db:start", { stdio: "inherit", cwd: repositoryRoot });
  } else {
    console.log("[e2e setup] Local Supabase is already running.");
  }

  console.log("[e2e setup] Resetting local database with seed data...");
  execSync("pnpm db:reset", { stdio: "inherit", cwd: repositoryRoot });
}

function checkSupabaseRunning(): boolean {
  try {
    execSync("supabase status", { stdio: "ignore", cwd: repositoryRoot });
    return true;
  } catch {
    return false;
  }
}

export default globalSetup;
