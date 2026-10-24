import "server-only";
import { getAdminDb } from "@/server/foundation/identity/db";
import type { AdminRole, CreditLedgerEntry, CreditLedgerEntryType } from "@/lib/domain/admin/types";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { writeAdminAuditEvent } from "@/server/application/admin/services/admin-audit";

export const CREDIT_APPROVAL_THRESHOLDS_CENTS: Record<AdminRole, number> = {
  support_agent: 2500, // $25
  support_manager: 10000, // $100
  billing_admin: 50000, // $500
  super_admin: Number.MAX_SAFE_INTEGER,
  operations_admin: 0,
  security_auditor: 0,
  read_only_admin: 0,
};

/**
 * Validates whether the given roles can directly issue a credit of `amountCents`
 * without requiring elevated secondary approval.
 */
export function canDirectlyIssueCredit(roles: AdminRole[], amountCents: number): boolean {
  let maxAllowed = 0;
  for (const role of roles) {
    const allowed = CREDIT_APPROVAL_THRESHOLDS_CENTS[role] ?? 0;
    if (allowed > maxAllowed) {
      maxAllowed = allowed;
    }
  }
  return amountCents <= maxAllowed;
}

/**
 * Calculate the total credit balance for a workspace from the append-only ledger.
 */
export async function calculateWorkspaceCreditBalance(workspaceId: string): Promise<number> {
  await requireAdminContext("view:credits");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("billing_credit_ledger")
    .select("amount_cents")
    .eq("workspace_id", workspaceId);

  if (!rows) return 0;
  return (rows as Array<{ amount_cents: number }>).reduce(
    (acc, r) => acc + (r.amount_cents ?? 0),
    0,
  );
}

export async function listWorkspaceCreditEntries(
  workspaceId: string,
): Promise<CreditLedgerEntry[]> {
  await requireAdminContext("view:credits");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("billing_credit_ledger")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      workspace_id: string;
      amount_cents: number;
      currency: string;
      type: CreditLedgerEntryType;
      reason: string;
      internal_note?: string;
      related_ticket_id?: string;
      related_invoice_id?: string;
      stripe_reference?: string;
      created_by_admin_id: string;
      created_at: string;
      expires_at?: string;
      reversed_entry_id?: string;
    }>
  ).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    type: row.type,
    reason: row.reason,
    internalNote: row.internal_note,
    relatedTicketId: row.related_ticket_id,
    relatedInvoiceId: row.related_invoice_id,
    stripeReference: row.stripe_reference,
    createdByAdminId: row.created_by_admin_id,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    reversedEntryId: row.reversed_entry_id,
  }));
}

export interface IssueCreditParams {
  workspaceId: string;
  amountCents: number;
  currency?: string;
  type: CreditLedgerEntryType;
  reason: string;
  internalNote?: string;
  relatedTicketId?: string;
}

/**
 * Issue a credit to a workspace ledger. Enforces role thresholds and logs an audit event.
 */
export async function issueWorkspaceCredit(params: IssueCreditParams): Promise<CreditLedgerEntry> {
  const ctx = await requireAdminContext("create:credits");
  if (!params.reason || params.reason.trim().length < 3) {
    throw new Error("A clear reason is required to issue a credit.");
  }
  if (params.amountCents === 0) {
    throw new Error("Credit amount cannot be zero.");
  }
  if (!canDirectlyIssueCredit(ctx.roles, Math.abs(params.amountCents))) {
    throw new Error(
      `Credit amount exceeds approval threshold for roles [${ctx.roles.join(", ")}]. Secondary approval required.`,
    );
  }

  const db = getAdminDb();
  const { data, error } = await db
    .from("billing_credit_ledger")
    .insert({
      workspace_id: params.workspaceId,
      amount_cents: params.amountCents,
      currency: params.currency ?? "AUD",
      type: params.type,
      reason: params.reason,
      internal_note: params.internalNote ?? null,
      related_ticket_id: params.relatedTicketId ?? null,
      created_by_admin_id: ctx.adminUser.id,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to issue workspace credit: ${error?.message}`);
  }

  const entry = data as { id: string; created_at: string };

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "billing_admin",
    action: "issue_credit",
    targetType: "credit_ledger",
    targetId: entry.id,
    workspaceId: params.workspaceId,
    reason: params.reason,
    metadata: { amountCents: params.amountCents, type: params.type },
  });

  const list = await listWorkspaceCreditEntries(params.workspaceId);
  return list.find((e) => e.id === entry.id)!;
}

/**
 * Reverse a credit entry by appending a reversing ledger entry. Never silently edits or deletes.
 */
export async function reverseWorkspaceCredit(
  entryId: string,
  workspaceId: string,
  reason: string,
): Promise<CreditLedgerEntry> {
  await requireAdminContext("manage:credits");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A reason is required to reverse a credit entry.");
  }

  const list = await listWorkspaceCreditEntries(workspaceId);
  const target = list.find((e) => e.id === entryId);
  if (!target) {
    throw new Error("Credit ledger entry not found.");
  }

  return issueWorkspaceCredit({
    workspaceId,
    amountCents: -target.amountCents,
    currency: target.currency,
    type: "credit_reversed",
    reason: `Reversal of entry ${entryId}: ${reason}`,
  });
}
