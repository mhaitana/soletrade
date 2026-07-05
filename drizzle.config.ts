import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env / .env.local so drizzle-kit can read DATABASE_URL without extra setup.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  verbose: true,
  strict: true,
});
