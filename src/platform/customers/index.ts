import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, pgQuote, unwrap, unwrapMaybe } from "@/server/db/helpers";
import { branded, type CustomerId, type UserId, type WorkspaceId } from "@/shared/types/ids";
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

/** Maps a snake_case PostgREST customers row to the camelCase `CustomerRow`. */
function toCustomerRow(r: {
  id: string;
  workspace_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}): CustomerRow {
  return {
    id: branded<"CustomerId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    notes: r.notes,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

const CUSTOMER_COLUMNS =
  "id, workspace_id, name, email, phone, company, notes, created_at, updated_at";

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
  deterministicId?: CustomerId,
): Promise<CustomerId> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("customers")
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        name: input.name.trim(),
        email: normalizeEmail(input.email) ?? null,
        phone: cleanOptional(input.phone),
        company: cleanOptional(input.company),
        notes: cleanOptional(input.notes),
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create customer.");
  const id = branded<"CustomerId">(row.id);
  await publishEvent({
    type: "CustomerCreated",
    workspaceId,
    actorUserId: actorId,
    entityType: "customer",
    entityId: id,
    metadata: { name: input.name },
  });
  return id;
}

/** List active customers for a workspace, optionally filtered by a search term. */
export async function listCustomers(
  workspaceId: WorkspaceId,
  opts?: { search?: string; offset?: number; limit?: number },
): Promise<CustomerRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 200);
  let query = supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  const search = opts?.search?.trim();
  if (search) {
    // ILIKE across name/email/company - the original ORd three parameterized ilike
    // calls. PostgREST expresses this as an `or` filter; the term is pgQuote'd so
    // commas/parens/quotes in the search don't break the expression structure.
    const term = pgQuote(`%${search}%`);
    query = query.or(`name.ilike.${term},email.ilike.${term},company.ilike.${term}`);
  }
  const rows = await unwrap(
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(Math.max(0, opts?.offset ?? 0), Math.max(0, opts?.offset ?? 0) + limit - 1),
  );
  return rows.map(toCustomerRow);
}

/**
 * Fetch a single customer, scoped to the workspace. This is the IDOR-safe getter
 * - it never returns a customer belonging to another workspace.
 */
export async function getCustomer(
  workspaceId: WorkspaceId,
  customerId: CustomerId,
): Promise<CustomerRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("id", customerId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return row ? toCustomerRow(row) : null;
}

/**
 * Find an active customer by email within a workspace (IDOR-safe). Email is
 * normalised to lowercase/trimmed the same way `createCustomer` does, so the
 * lookup matches the partial unique index `customers_workspace_email_unique`
 * (`email is not null and deletedAt is null`). Returns `null` for a missing or
 * empty email, or when no active customer has that email. Used by the AI
 * `createCustomer` write-tool to recover from a duplicate-email collision by
 * returning the existing customer instead of throwing.
 */
export async function getCustomerByEmail(
  workspaceId: WorkspaceId,
  email: string | null | undefined,
): Promise<CustomerRow | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("email", normalized)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return row ? toCustomerRow(row) : null;
}

/** Update a customer (workspace-isolated). Throws if not found. */
export async function updateCustomer(
  workspaceId: WorkspaceId,
  customerId: CustomerId,
  patch: CustomerPatch,
  actorId: UserId,
  expectedUpdatedAt?: string,
): Promise<void> {
  const supabase = getDataClient();
  // Explicit column-keyed shape (not a loose Record<string, unknown>) so the typed
  // `.update()` payload accepts it - the generated Update type rejects an `unknown`
  // index signature. `updated_at` is always set; the rest are conditional on the patch.
  const set: {
    updated_at: string;
    mobile_expected_updated_at?: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    notes?: string | null;
  } = {
    updated_at: new Date().toISOString(),
    ...(expectedUpdatedAt !== undefined ? { mobile_expected_updated_at: expectedUpdatedAt } : {}),
  };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.email !== undefined) set.email = normalizeEmail(patch.email) ?? null;
  if (patch.phone !== undefined) set.phone = cleanOptional(patch.phone);
  if (patch.company !== undefined) set.company = cleanOptional(patch.company);
  if (patch.notes !== undefined) set.notes = cleanOptional(patch.notes);

  const rows = await unwrap(
    supabase
      .from("customers")
      .update(set)
      .eq("id", customerId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .select("id"),
  );
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
  const supabase = getDataClient();
  const nowIso = new Date().toISOString();
  const rows = await unwrap(
    supabase
      .from("customers")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("id", customerId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .select("id"),
  );
  if (!rows[0]) throw new Error("Customer not found.");
  await publishEvent({
    type: "CustomerDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "customer",
    entityId: customerId,
  });
}
