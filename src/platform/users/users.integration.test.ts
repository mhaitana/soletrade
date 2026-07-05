import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type UserId } from "@/shared/types/ids";
import { ensureUserMirror, getUser } from "@/platform/users";

/**
 * Integration tests for the public.users mirror service against a real Postgres.
 *
 * Run only when DATABASE_URL is set (local Supabase or a throwaway test DB).
 * Without it, `pnpm test:ci` skips this file so the unit suite stays green.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("users mirror integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">(crypto.randomUUID());
  const email = `mirror-${actor.replace(/-/g, "").slice(0, 12)}@soletrade-test.local`;
  const secondEmail = `mirror2-${actor.replace(/-/g, "").slice(0, 12)}@soletrade-test.local`;

  afterAll(async () => {
    const db = getDb();
    // Clean up any stray workspaces/memberships that might reference the user,
    // then the user row itself.
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, actor));
    await db.delete(workspacesTable).where(eq(workspacesTable.ownerId, actor));
    await db.delete(usersTable).where(eq(usersTable.id, actor));
  });

  it("inserts a row on first call (with full name)", async () => {
    await ensureUserMirror({ id: actor, email, fullName: "Mirror Test" });
    const row = await getUser(actor);
    expect(row?.email).toBe(email);
    expect(row?.fullName).toBe("Mirror Test");
  });

  it("upserts on a second call — updates email + name without duplicating", async () => {
    await ensureUserMirror({ id: actor, email: secondEmail, fullName: "Mirror Updated" });
    const db = getDb();
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, actor));
    expect(rows).toHaveLength(1);
    const row = await getUser(actor);
    expect(row?.email).toBe(secondEmail);
    expect(row?.fullName).toBe("Mirror Updated");
  });

  it("preserves an existing full_name when the update omits it", async () => {
    // Defensive call (as createWorkspaceAction makes) — no fullName supplied.
    await ensureUserMirror({ id: actor, email: secondEmail });
    const row = await getUser(actor);
    expect(row?.fullName).toBe("Mirror Updated");
  });

  it("allows null full_name on a fresh insert that omits it", async () => {
    const fresh = branded<"UserId">(crypto.randomUUID());
    const freshEmail = `mirror3-${fresh.replace(/-/g, "").slice(0, 12)}@soletrade-test.local`;
    await ensureUserMirror({ id: fresh, email: freshEmail });
    const row = await getUser(fresh);
    expect(row?.email).toBe(freshEmail);
    expect(row?.fullName).toBeNull();
    // cleanup
    const db = getDb();
    await db.delete(usersTable).where(eq(usersTable.id, fresh));
  });

  it("returns null from getUser for a non-existent user", async () => {
    const missing = branded<"UserId">(crypto.randomUUID());
    const row = await getUser(missing);
    expect(row).toBeNull();
  });
});
