import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { workspaces, workspaceMembers } from "@/server/db/schema";
import type { WorkspaceRole } from "@/server/db/schema/enums";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
import { branded } from "@/shared/types/ids";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

/** Cookie holding the user's currently-active workspace id. */
export const ACTIVE_WORKSPACE_COOKIE = "soletrade:wid";

/** Create a workspace and the owner membership in one transaction. */
export async function createWorkspace(
  ownerId: UserId,
  name: string,
  slug: string,
): Promise<WorkspaceId> {
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(workspaces)
      .values({ name, slug, ownerId })
      .returning({ id: workspaces.id });
    const ws = rows[0];
    if (!ws) throw new Error("Failed to create workspace");
    await tx.insert(workspaceMembers).values({
      workspaceId: ws.id,
      userId: ownerId,
      role: "owner",
    });
    return ws.id;
  });
  await publishEvent({
    type: "WorkspaceCreated",
    workspaceId: id,
    actorUserId: ownerId,
    entityType: "workspace",
    entityId: id,
    metadata: { name, slug },
  });
  await writeAudit({
    workspaceId: id,
    actorUserId: ownerId,
    action: "workspace.create",
    targetType: "workspace",
    targetId: id,
    metadata: { name, slug },
  });
  return id;
}

/** List all workspaces the user is an active member of. */
export async function listUserWorkspaces(userId: UserId): Promise<WorkspaceMembership[]> {
  const db = getDb();
  return db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    );
}

/** Resolve a single workspace (not soft-deleted). */
export async function getWorkspace(workspaceId: WorkspaceId) {
  const db = getDb();
  const rows = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** The user's role in a workspace, or `null` if not an active member. */
export async function getMembershipRole(
  workspaceId: WorkspaceId,
  userId: UserId,
): Promise<WorkspaceRole | null> {
  const db = getDb();
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Read the active-workspace cookie. */
export async function getActiveWorkspaceId(): Promise<WorkspaceId | null> {
  const store = await cookies();
  const value = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return value ? branded<"WorkspaceId">(value) : null;
}

/** Write the active-workspace cookie (1 year, httpOnly, lax). */
export async function setActiveWorkspaceId(id: WorkspaceId): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}
