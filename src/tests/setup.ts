import { spawnSync } from "node:child_process";
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

/**
 * Probe whether the Postgres at `DATABASE_URL` is actually reachable. The
 * integration test files gate themselves with `HAS_DB = Boolean(process.env.DATABASE_URL)`
 * at module top-level, so when `.env.local` injects a `DATABASE_URL` but Supabase
 * isn't running, those files would otherwise RUN and fail with `ECONNREFUSED`
 * instead of skipping. To keep the gate honest we do a quick TCP connect here:
 * if it fails (Supabase stopped, CI without a DB, etc.) we drop `DATABASE_URL`
 * from `process.env` so every `HAS_DB` gate flips to false and the integration
 * suite skips cleanly. Synchronous + child-process-based so it runs before any
 * test file's top-level `HAS_DB` is evaluated.
 */
function isDbReachable(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  let port: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = parsed.port || "5432";
  } catch {
    return false;
  }
  // Spawn a one-shot node child that opens a TCP connection and exits 0 on
  // success / 1 on error or timeout. spawnSync blocks setup until it returns.
  const res = spawnSync(
    process.execPath,
    [
      "-e",
      `const net=require('net');const s=net.createConnection({host:${JSON.stringify(host)},port:Number(${JSON.stringify(port)})},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>{s.destroy();process.exit(1)},1000);`,
    ],
    { timeout: 2000 },
  );
  return res.status === 0;
}

if (process.env.DATABASE_URL && !isDbReachable(process.env.DATABASE_URL)) {
  delete process.env.DATABASE_URL;
}

afterEach(() => {
  cleanup();
});
