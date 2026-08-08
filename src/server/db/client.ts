import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/shared/lib/env";
import type { Database } from "@/server/db/types";

/**
 * Supabase server **data** client (migration off Drizzle). Server-only infra, sibling
 * to `src/server/storage/index.ts` (the Storage admin client) and `src/server/email`.
 *
 * Uses the **service-role** key, which bypasses RLS - exactly like the Storage client.
 * Workspace scoping is therefore enforced in **code** for this client (every service filters by
 * `workspaceId` resolved from the session, never from a client-supplied value). Authenticated
 * Data API access is separately protected by the project's RLS policies as defense in depth.
 *
 * Throws clearly when not configured (mirrors `getStorageAdminClient` / `getStripe`)
 * because a missing config should fail the request loudly, not silently no-op. The
 * client is lazily constructed + cached. PostgREST has no multi-statement transactions,
 * so atomic write paths go through PL/pgSQL RPC functions (`supabase.rpc(...)`).
 */

let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Returns the cached service-role data client, or throws if Supabase URL or
 * service-role key is unset. Call from server code only.
 */
export function getDataClient(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase data client is not configured - set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/** Test-only: reset the cached client (e.g. after stubbing env in a unit test). */
export function resetDataClientForTest(): void {
  cachedClient = null;
}
