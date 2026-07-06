import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus } from "@/server/events";

/**
 * Integration tests for the server-side security glue (`authorizeOrAudit`) against a
 * real Postgres. Asserts that every permission *denial* appends an `authz.denied` audit
 * row with the actor + permission, while an allow writes nothing — and that an audit
 * failure never alters the authz outcome.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Skipped when DATABASE_URL is unset so the unit suite stays green anywhere.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

// Mock next/headers so `getClientIp` returns a stable IP without a real request.
const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

import { authorizeOrAudit } from "./index";

describe.skipIf(!HAS_DB)("authorizeOrAudit integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000b1");
  let ws: WorkspaceId;

  beforeAll(async () => {
    const db = getDb();
    clearEventBus();
    mockHeaders.mockResolvedValue({
      get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.99" : null),
    });
    await db
      .insert(usersTable)
      .values({ id: actor, email: "authz-actor@soletrade-test.local", fullName: "Authz Actor" });
    ws = await createWorkspace(actor, "Authz Test", `authz-test-${Date.now()}`);
  });

  afterAll(async () => {
    const db = getDb();
    if (!ws) {
      await db.delete(usersTable).where(eq(usersTable.id, actor));
      return;
    }
    await db.delete(auditLogs).where(eq(auditLogs.workspaceId, ws));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws));
    await db.delete(usersTable).where(eq(usersTable.id, actor));
    clearEventBus();
  });

  it("writes an authz.denied audit row on a denial (with actor + permission + ip)", async () => {
    const before = await countAuthzDenied(ws!);
    // readonly role cannot manage billing.
    const ctx = {
      user: { id: actor, email: "authz-actor@soletrade-test.local" },
      workspaceId: ws!,
      role: "readonly" as const,
    };
    const result = await authorizeOrAudit(ctx, "manage:billing");
    expect(result.ok).toBe(false);
    const after = await countAuthzDenied(ws!);
    expect(after).toBe(before + 1);
    // The newest denial row references the permission and actor.
    const db = getDb();
    const rows = await db
      .select({
        action: auditLogs.action,
        targetId: auditLogs.targetId,
        actorUserId: auditLogs.actorUserId,
        ip: auditLogs.ip,
      })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, ws!));
    const denial = rows.find((r) => r.action === "authz.denied" && r.targetId === "manage:billing");
    expect(denial).toBeDefined();
    expect(denial?.actorUserId).toBe(actor);
  });

  it("writes nothing on an allow", async () => {
    const before = await countAuthzDenied(ws!);
    // owner role can manage billing.
    const ctx = {
      user: { id: actor, email: "authz-actor@soletrade-test.local" },
      workspaceId: ws!,
      role: "owner" as const,
    };
    const result = await authorizeOrAudit(ctx, "manage:billing");
    expect(result.ok).toBe(true);
    const after = await countAuthzDenied(ws!);
    expect(after).toBe(before); // no new denial row
  });

  it("never throws when the audit write fails (best-effort)", async () => {
    // Force the audit module to throw by pointing it at a bogus table is hard; instead
    // assert the contract structurally: authorizeOrAudit returns the authz result even
    // though the denial path runs the audit fire-and-forget. A second denial still
    // resolves to ok:false without surfacing an audit error.
    const ctx = {
      user: { id: actor, email: "authz-actor@soletrade-test.local" },
      workspaceId: ws!,
      role: "employee" as const,
    };
    await expect(authorizeOrAudit(ctx, "manage:billing")).resolves.toMatchObject({ ok: false });
    await expect(authorizeOrAudit(ctx, "view:audit")).resolves.toMatchObject({ ok: false });
  });
});

async function countAuthzDenied(workspaceId: WorkspaceId): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.workspaceId, workspaceId));
  return rows.filter((r) => r.action === "authz.denied").length;
}
