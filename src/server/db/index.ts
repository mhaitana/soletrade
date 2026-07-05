import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/shared/lib/env";

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  return drizzle(postgres(env.DATABASE_URL!, { max: 10 }), { schema });
}

/**
 * Lazy Drizzle client. Marketing/auth-less routes don't import this module, so
 * the app still boots without `DATABASE_URL`. App routes call `getDb()` at the
 * top of a server action/helper, which throws a clear error if the URL is unset.
 */
export function getDb() {
  if (_db) return _db;
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env.local and set a Supabase pooled connection string.",
    );
  }
  _db = createDb();
  return _db;
}

export type Db = ReturnType<typeof getDb>;
export * from "./schema";
