import { execSync } from "node:child_process";

/**
 * Playwright global setup.
 *
 * Ensures the local Supabase stack is running and resets the database with
 * seed data once before the E2E suite starts. This gives every spec a known,
 * deterministic world (seeded users, workspaces, invoices, quotes, etc.).
 */
async function globalSetup(): Promise<void> {
  const isSupabaseRunning = checkSupabaseRunning();

  if (!isSupabaseRunning) {
    console.log("[e2e setup] Local Supabase is not running. Starting it...");
    execSync("pnpm db:start", { stdio: "inherit" });
  } else {
    console.log("[e2e setup] Local Supabase is already running.");
  }

  console.log("[e2e setup] Resetting local database with seed data...");
  execSync("pnpm db:reset", { stdio: "inherit" });
}

function checkSupabaseRunning(): boolean {
  try {
    execSync("supabase status", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export default globalSetup;
