import { loadEnv } from "vite";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest runs in test mode, where Vite intentionally skips `.env.local`. We
// want the same local Supabase values the dev server uses, so load `.env.local`
// explicitly (development mode loads it) and populate `process.env` for the
// DATABASE_URL-gated integration tests. Never clobber vitest's NODE_ENV=test,
// and never overwrite a variable already set by the environment.
const loaded = loadEnv("development", process.cwd(), "");
for (const [key, value] of Object.entries(loaded)) {
  if (key === "NODE_ENV") continue;
  if (process.env[key] === undefined) process.env[key] = value;
}

afterEach(() => {
  cleanup();
});
