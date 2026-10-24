import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrapVoid } from "@/server/infrastructure/db/helpers";
import type { WorkspaceId, UserId } from "@/types/ids";

/**
 * Shared DB seed/teardown helpers for integration tests (Phase 6 of the Drizzle→Supabase
 * data-layer migration). Integration tests self-seed against the local Supabase via the
 * same service-role data client the app uses; these helpers collapse the repeated
 * user-seed + workspace-cleanup boilerplate that was duplicated across every integration
 * test file when it used Drizzle's `getDb()`.
 *
 * No `import "server-only"` here: vitest runs in a Node process where the data client's
 * own `server-only` guard is already satisfied, and adding it would needlessly couple this
 * test helper to the server bundle.
 */

export interface TestUser {
  id: UserId;
  email: string;
  fullName?: string;
}

/**
 * Insert test users directly into the `users` table (the public mirror that backs the
 * workspace/member FKs). Bypasses Supabase Auth - these rows exist only so workspace +
 * member rows have a valid `user_id` FK. Idempotent-ish: callers use fixed, file-unique
 * UUIDs and clean them up in `cleanupWorkspaces`.
 */
export async function seedUsers(users: TestUser[]): Promise<void> {
  if (users.length === 0) return;
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("users")
      .insert(users.map((u) => ({ id: u.id, email: u.email, full_name: u.fullName ?? null }))),
  );
}

/** A workspace-scoped table to purge in `cleanupWorkspaces` (deleted before the tail). */
export interface CleanupTable {
  table: string;
  /** Column scoped to the workspace ids. Defaults to `"workspace_id"`. */
  column?: string;
}

/**
 * Tear down a test's workspace(s): delete the given module/extra tables **in order** (so
 * FK dependents go before their parents), then the common tail - `workspace_members`, the
 * `workspaces` rows, and finally the seed `users`. Pass every workspace-scoped table the
 * test touched (`customers`, `audit_logs`, `activity_events`, `credit_ledger`, the module
 * tables, …) in FK-dependency order. `workspace_members` is ALWAYS deleted by the helper
 * and must NOT be repeated in `tables`. No-op when `workspaceIds` is empty (the seed users
 * are still deleted when `userIds` is non-empty).
 */
export async function cleanupWorkspaces(
  workspaceIds: WorkspaceId[],
  userIds: UserId[],
  tables: CleanupTable[] = [],
): Promise<void> {
  const supabase = getDataClient();
  if (workspaceIds.length > 0) {
    for (const { table, column = "workspace_id" } of tables) {
      // The typed supabase client's `.from()`/`.in()` require literal table + column names;
      // here both are runtime strings, so cast through `never` to satisfy the call signature
      // (PostgREST happily accepts string relation/column names at runtime).
      await unwrapVoid(
        supabase
          .from(table as never)
          .delete()
          .in(column as never, workspaceIds as never) as never,
      );
    }
    await unwrapVoid(supabase.from("workspace_members").delete().in("workspace_id", workspaceIds));
    await unwrapVoid(supabase.from("workspaces").delete().in("id", workspaceIds));
  }
  if (userIds.length > 0) {
    await unwrapVoid(supabase.from("users").delete().in("id", userIds));
  }
}
