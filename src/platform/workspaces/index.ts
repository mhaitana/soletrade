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
import { env } from "@/shared/lib/env";

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

/** Full workspace row shape (all columns). The shape `getWorkspace` returns. */
export type WorkspaceRow = NonNullable<Awaited<ReturnType<typeof getWorkspace>>>;

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

/** Editable workspace fields (Wave 4 — `/settings/general`). The slug stays immutable v1. */
export interface WorkspaceUpdateInput {
  name: string;
  defaultCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  timezone: string;
}

/**
 * Update a workspace's editable settings (name + currency + prefixes + timezone). The caller
 * (a Server Action) is responsible for the `update:workspace` permission gate. Publishes
 * `WorkspaceUpdated` + audits `workspace.update`. Returns the updated row, or `null` if the
 * workspace wasn't found / is soft-deleted.
 */
export async function updateWorkspace(
  workspaceId: WorkspaceId,
  input: WorkspaceUpdateInput,
  actorId: UserId,
) {
  const db = getDb();
  const rows = await db
    .update(workspaces)
    .set({
      name: input.name,
      defaultCurrency: input.defaultCurrency,
      invoicePrefix: input.invoicePrefix,
      quotePrefix: input.quotePrefix,
      timezone: input.timezone,
      updatedAt: new Date(),
    })
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .returning();
  const updated = rows[0] ?? null;
  if (!updated) return null;
  await publishEvent({
    type: "WorkspaceUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "workspace",
    entityId: workspaceId,
    metadata: {
      name: input.name,
      defaultCurrency: input.defaultCurrency,
      invoicePrefix: input.invoicePrefix,
      quotePrefix: input.quotePrefix,
      timezone: input.timezone,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "workspace.update",
    targetType: "workspace",
    targetId: workspaceId,
    metadata: {
      name: input.name,
      defaultCurrency: input.defaultCurrency,
      invoicePrefix: input.invoicePrefix,
      quotePrefix: input.quotePrefix,
      timezone: input.timezone,
    },
  });
  return updated;
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

/** Write the active-workspace cookie (1 year, httpOnly, lax, secure in production). */
export async function setActiveWorkspaceId(id: WorkspaceId): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}
