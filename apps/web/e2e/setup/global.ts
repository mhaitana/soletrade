import { repositoryRoot } from "./paths";
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateE2ETarget } from "../../scripts/lib/e2e-environment";

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
  validateE2ETarget(
    process.env,
    readFileSync(path.join(repositoryRoot, "supabase/config.toml"), "utf8"),
  );
  console.log("[e2e setup] Checking local Supabase health...");
  const isSupabaseRunning = checkSupabaseRunning();

  if (!isSupabaseRunning) {
    console.log("[e2e setup] Local Supabase is not running. Starting it...");
    execSync("pnpm db:start", { stdio: "inherit", cwd: repositoryRoot });
  } else {
    console.log("[e2e setup] Local Supabase is already running.");
  }

  console.log("[e2e setup] Resetting local database with seed data...");
  execSync("pnpm db:reset --local", { stdio: "inherit", cwd: repositoryRoot });
}

function checkSupabaseRunning(): boolean {
  try {
    execFileSync("supabase", ["status"], {
      stdio: "ignore",
      cwd: repositoryRoot,
      timeout: 30_000,
    });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ETIMEDOUT") {
      throw new Error(
        "Local Supabase did not respond within 30 seconds. Check Docker health before rerunning E2E; no database reset was attempted.",
      );
    }
    return false;
  }
}

export default globalSetup;
