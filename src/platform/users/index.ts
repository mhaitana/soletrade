import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import type { UserId } from "@/shared/types/ids";

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
 */
export async function ensureUserMirror(input: EnsureUserMirrorInput): Promise<void> {
  const db = getDb();
  const fullName = input.fullName?.trim() || null;
  await db
    .insert(users)
    .values({
      id: input.id,
      email: input.email,
      fullName,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: input.email,
        updatedAt: new Date(),
        // Only overwrite full_name when a value was supplied; preserves the
        // existing name on defensive calls that only pass id + email.
        ...(fullName ? { fullName } : {}),
      },
    });
}

/** Fetch the public profile mirror for a user, or `null` if none exists. */
export async function getUser(id: UserId): Promise<UserMirrorRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}
