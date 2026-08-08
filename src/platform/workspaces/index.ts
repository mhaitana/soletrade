import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getDataClient } from "@/server/db/client";
import { rpc, unwrap, unwrapMaybe } from "@/server/db/helpers";
import type { WorkspaceRole } from "@/server/db/enums";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
import { branded } from "@/shared/types/ids";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { env } from "@/shared/lib/env";
import type { Json } from "@/server/db/types";
import { parsePaymentMethods, type PaymentMethods } from "@/shared/types/payment-methods";

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

/** Full workspace row shape (camelCase - mapped from the snake_case PostgREST row at the
 *  service boundary so consumers keep the same field names Drizzle exposed). Timestamps come
 *  back as ISO strings from PostgREST (Drizzle returned `Date`); no consumer reads them today. */
export interface WorkspaceRow {
  id: WorkspaceId;
  name: string;
  slug: string;
  ownerId: UserId;
  defaultCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  timezone: string;
  fyStartMonth: number;
  paymentMethods: PaymentMethods;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Maps a snake_case PostgREST workspaces row to the camelCase `WorkspaceRow` contract. */
function toWorkspaceRow(r: {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  default_currency: string;
  invoice_prefix: string;
  quote_prefix: string;
  timezone: string;
  fy_start_month: number;
  payment_methods: Json | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}): WorkspaceRow {
  return {
    id: branded<"WorkspaceId">(r.id),
    name: r.name,
    slug: r.slug,
    ownerId: branded<"UserId">(r.owner_user_id),
    defaultCurrency: r.default_currency,
    invoicePrefix: r.invoice_prefix,
    quotePrefix: r.quote_prefix,
    timezone: r.timezone,
    fyStartMonth: r.fy_start_month,
    paymentMethods: (() => {
      const parsed = parsePaymentMethods(r.payment_methods);
      return parsed.ok ? parsed.methods : [];
    })(),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

const WORKSPACE_COLUMNS =
  "id, name, slug, owner_user_id, default_currency, invoice_prefix, quote_prefix, timezone, fy_start_month, payment_methods, created_at, updated_at, deleted_at";

/** Cookie holding the user's currently-active workspace id. */
export const ACTIVE_WORKSPACE_COOKIE = "soletrade:wid";

/** Create a workspace and the owner membership in one transaction. */
export async function createWorkspace(
  ownerId: UserId,
  name: string,
  slug: string,
): Promise<WorkspaceId> {
  // Atomic insert (workspace + owner membership) via the `create_workspace_with_owner`
  // PL/pgSQL RPC. PostgREST has no multi-statement transactions, so the two inserts live
  // in one function. The `publishEvent`/`writeAudit` run AFTER the rpc returns (a tiny
  // non-atomic gap between the row writes and the event/audit rows - acceptable: the event
  // bus is best-effort and consumers are idempotent).
  const supabase = getDataClient();
  const { data, error } = await rpc(supabase, "create_workspace_with_owner", {
    p_owner_user_id: ownerId,
    p_name: name,
    p_slug: slug,
  });
  if (error) {
    throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  }
  if (!data) throw new Error("Failed to create workspace");
  const id = branded<"WorkspaceId">(data);
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
async function queryUserWorkspaces(userId: UserId): Promise<WorkspaceMembership[]> {
  const supabase = getDataClient();
  // Query the membership side and embed the parent workspace (many-to-one → a single nested
  // object, not an array). Active memberships are filtered in SQL (`deleted_at IS NULL` on the
  // member row); the parent workspace's soft-delete is filtered in JS (PostgREST can't filter
  // the embedded side's columns from the "many" query), so dead workspaces are dropped here.
  const rows = await unwrap(
    supabase
      .from("workspace_members")
      .select(`role, workspaces ( ${WORKSPACE_COLUMNS} )`)
      .eq("user_id", userId)
      .is("deleted_at", null),
  );
  return rows.flatMap((r) => {
    const w = r.workspaces;
    if (!w || w.deleted_at !== null) return [];
    return [
      {
        workspaceId: branded<"WorkspaceId">(w.id),
        name: w.name,
        slug: w.slug,
        role: r.role,
      },
    ];
  });
}

export const listUserWorkspaces = cache(queryUserWorkspaces);

/** Resolve a single workspace (not soft-deleted). */
async function queryWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("workspaces")
      .select(WORKSPACE_COLUMNS)
      .eq("id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return row ? toWorkspaceRow(row) : null;
}

export const getWorkspace = cache(queryWorkspace);

/** Editable workspace fields (Wave 4 - `/settings/general`). The slug stays immutable v1. */
export interface WorkspaceUpdateInput {
  name: string;
  defaultCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  timezone: string;
  /** Financial-year start month, 1–12 (1 = January, 7 = July). */
  fyStartMonth: number;
  /** Customer-facing payment methods (jsonb array). Empty array is stored as `[]`. */
  paymentMethods: PaymentMethods;
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
): Promise<WorkspaceRow | null> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("workspaces")
      .update({
        name: input.name,
        default_currency: input.defaultCurrency,
        invoice_prefix: input.invoicePrefix,
        quote_prefix: input.quotePrefix,
        timezone: input.timezone,
        fy_start_month: input.fyStartMonth,
        payment_methods: (input.paymentMethods.length > 0
          ? input.paymentMethods
          : null) as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspaceId)
      .is("deleted_at", null)
      .select(WORKSPACE_COLUMNS),
  );
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
      fyStartMonth: input.fyStartMonth,
      paymentMethodsCount: input.paymentMethods.length,
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
      fyStartMonth: input.fyStartMonth,
      paymentMethodsCount: input.paymentMethods.length,
    },
  });
  return toWorkspaceRow(updated);
}

/** The user's role in a workspace, or `null` if not an active member. */
export async function getMembershipRole(
  workspaceId: WorkspaceId,
  userId: UserId,
): Promise<WorkspaceRole | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return row ? row.role : null;
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
