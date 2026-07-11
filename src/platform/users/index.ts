import "server-only";
import { getDataClient } from "@/server/db/client";
import { unwrapMaybe, unwrapVoid } from "@/server/db/helpers";
import { branded, type UserId } from "@/shared/types/ids";

export interface UserMirrorRow {
  id: UserId;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface EnsureUserMirrorInput {
  id: UserId;
  email: string;
  /** Optional — when omitted, an existing full_name is preserved (not nulled). */
  fullName?: string | null;
}

/**
 * Upsert the public.users mirror of the Supabase Auth user. The Supabase auth
 * user id is the primary key, so this is idempotent — safe to call at every
 * session-establishment point (signup, magic-link callback, defensively before
 * workspace creation). When `fullName` is omitted on an update, the existing
 * value is preserved rather than overwritten with NULL.
 *
 * PostgREST `.upsert()` with `onConflict: 'id'` updates only the columns present
 * in the payload on conflict, so omitting `full_name` when it isn't supplied
 * preserves the existing value — matching the old Drizzle conditional spread.
 */
export async function ensureUserMirror(input: EnsureUserMirrorInput): Promise<void> {
  const supabase = getDataClient();
  const fullName = input.fullName?.trim() || null;
  const payload: { id: string; email: string; updated_at: string; full_name?: string | null } = {
    id: input.id,
    email: input.email,
    updated_at: new Date().toISOString(),
  };
  // Only include full_name in the payload when a value was supplied; on a conflict
  // the column is left untouched (preserved), on an insert it defaults to NULL.
  if (fullName) payload.full_name = fullName;
  await unwrapVoid(supabase.from("users").upsert(payload, { onConflict: "id" }));
}

/** Fetch the public profile mirror for a user, or `null` if none exists. */
export async function getUser(id: UserId): Promise<UserMirrorRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase.from("users").select("id, email, full_name, avatar_url").eq("id", id).maybeSingle(),
  );
  if (!row) return null;
  return {
    id: branded<"UserId">(row.id),
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
  };
}

/**
 * Update the signed-in user's full name on the `public.users` mirror (Wave 4 — `/settings/account`).
 * The mirror is the display source of truth (the AppShell + account menu read it), so updating it
 * here is sufficient for the UI to reflect the new name. Supabase Auth `user_metadata` is not
 * updated — it isn't read for display. An empty/whitespace name is rejected by the caller's Zod
 * schema; this trims + stores `null` if somehow empty.
 */
export async function updateUserFullName(id: UserId, fullName: string): Promise<void> {
  const supabase = getDataClient();
  const trimmed = fullName.trim() || null;
  await unwrapVoid(
    supabase
      .from("users")
      .update({ full_name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
}
