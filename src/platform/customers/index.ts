import "server-only";
import { and, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { customers } from "@/server/db/schema";
import type { CustomerId, UserId, WorkspaceId } from "@/shared/types/ids";
import { publishEvent } from "@/server/events";

export interface CustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
}

export type CustomerPatch = Partial<CustomerInput>;

export interface CustomerRow {
  id: CustomerId;
  workspaceId: WorkspaceId;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectRow = {
  id: customers.id,
  workspaceId: customers.workspaceId,
  name: customers.name,
  email: customers.email,
  phone: customers.phone,
  company: customers.company,
  notes: customers.notes,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
} as const;

/** Trim + lowercase emails; empty string → null. `undefined` means "leave unchanged". */
function normalizeEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function cleanOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Create a workspace-scoped customer. Email is normalised to lowercase. */
export async function createCustomer(
  workspaceId: WorkspaceId,
  input: CustomerInput,
  actorId: UserId,
): Promise<CustomerId> {
  const db = getDb();
  const rows = await db
    .insert(customers)
    .values({
      workspaceId,
      name: input.name.trim(),
      email: normalizeEmail(input.email) ?? null,
      phone: cleanOptional(input.phone),
      company: cleanOptional(input.company),
      notes: cleanOptional(input.notes),
    })
    .returning({ id: customers.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create customer.");
  await publishEvent({
    type: "CustomerCreated",
    workspaceId,
    actorUserId: actorId,
    entityType: "customer",
    entityId: row.id,
    metadata: { name: input.name },
  });
  return row.id;
}

/** List active customers for a workspace, optionally filtered by a search term. */
export async function listCustomers(
  workspaceId: WorkspaceId,
  opts?: { search?: string; limit?: number },
): Promise<CustomerRow[]> {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 200);
  const conditions: (SQL | undefined)[] = [
    eq(customers.workspaceId, workspaceId),
    isNull(customers.deletedAt),
  ];
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(ilike(customers.name, term), ilike(customers.email, term), ilike(customers.company, term)),
    );
  }
  return db
    .select(selectRow)
    .from(customers)
    .where(and(...conditions))
    .orderBy(desc(customers.createdAt))
    .limit(limit);
}

/**
 * Fetch a single customer, scoped to the workspace. This is the IDOR-safe getter
 * — it never returns a customer belonging to another workspace.
 */
export async function getCustomer(
  workspaceId: WorkspaceId,
  customerId: CustomerId,
): Promise<CustomerRow | null> {
  const db = getDb();
  const rows = await db
    .select(selectRow)
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.workspaceId, workspaceId),
        isNull(customers.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Update a customer (workspace-isolated). Throws if not found. */
export async function updateCustomer(
  workspaceId: WorkspaceId,
  customerId: CustomerId,
  patch: CustomerPatch,
  actorId: UserId,
): Promise<void> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.email !== undefined) set.email = normalizeEmail(patch.email) ?? null;
  if (patch.phone !== undefined) set.phone = cleanOptional(patch.phone);
  if (patch.company !== undefined) set.company = cleanOptional(patch.company);
  if (patch.notes !== undefined) set.notes = cleanOptional(patch.notes);

  const rows = await db
    .update(customers)
    .set(set)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.workspaceId, workspaceId),
        isNull(customers.deletedAt),
      ),
    )
    .returning({ id: customers.id });
  if (!rows[0]) throw new Error("Customer not found.");
  await publishEvent({
    type: "CustomerUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "customer",
    entityId: customerId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** Soft-delete a customer (workspace-isolated). Throws if not found. */
export async function deleteCustomer(
  workspaceId: WorkspaceId,
  customerId: CustomerId,
  actorId: UserId,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .update(customers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.workspaceId, workspaceId),
        isNull(customers.deletedAt),
      ),
    )
    .returning({ id: customers.id });
  if (!rows[0]) throw new Error("Customer not found.");
  await publishEvent({
    type: "CustomerDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "customer",
    entityId: customerId,
  });
}
