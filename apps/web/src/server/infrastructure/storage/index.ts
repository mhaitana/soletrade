import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/server/infrastructure/config/env";

/**
 * Supabase Storage admin client (Phase 11b). Server-only infra, sibling to
 * `src/server/email` and `src/server/stripe`.
 *
 * Uses the **service-role** key, which bypasses Storage RLS. Workspace scoping is
 * therefore enforced in **code** (the `files` platform service checks `workspaceId`
 * on every read/write, and object keys are namespaced `workspaces/{workspaceId}/…`)
 * - RLS policies on the bucket are defense-in-depth, not the primary boundary.
 *
 * Throws clearly when not configured (mirrors `getStripe`) because the upload/read
 * URL routes are request-critical: a missing config should fail the request loudly,
 * not silently no-op. The client is lazily constructed + cached.
 */

let cachedClient: SupabaseClient | null = null;

/**
 * Returns the cached service-role Storage client, or throws if Supabase URL or
 * service-role key is unset. Call from server code only.
 */
export function getStorageAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase Storage is not configured - set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/** The configured Storage bucket name (default "files"). */
export function storageBucket(): string {
  return env.SUPABASE_STORAGE_BUCKET;
}

/** Test-only: reset the cached client (e.g. after stubbing env in a unit test). */
export function resetStorageClientForTest(): void {
  cachedClient = null;
}
