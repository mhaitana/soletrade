import type {
  CreditEntryInput,
  CreditLedgerRow,
  CreditEntryResult,
} from "@/lib/domain/billing/credits-types";
export type {
  CreditEntryInput,
  CreditLedgerRow,
  CreditEntryResult,
} from "@/lib/domain/billing/credits-types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { parsePgTimestamp, rpc, unwrap, unwrapMaybe } from "@/server/infrastructure/db/helpers";
import type { Json } from "@/lib/domain/json";
import type { CreditLedgerEntryId, UserId, WorkspaceId } from "@/types/ids";
import { branded } from "@/types/ids";
import type { ModuleKey } from "@/config/modules";
import { publishEvent } from "@/server/infrastructure/events";
import { writeAudit } from "@/server/foundation/audit";

/**
 * Credit ledger service (brief §4 - "credit ledger, never a mutable balance").
 * Append-only: the only mutator is `appendCreditEntry`, called by the semantic
 * functions below. No update or delete is ever exposed. The balance is ALWAYS the
 * derived `SUM(amount_cents)` over these rows, never a stored column.
 *
 * Entries are signed integer cents:
 *   grant       +  credit issued (Stripe prepayment, etc.)
 *   promotion   +  promotional credit issued (distinct ledger type per brief §10.7)
 *   consumption −  credit applied to a charge
 *   refund      +  credit restored when a module is cancelled mid-cycle (4c)
 *   adjustment  ±  manual admin change
 *   expired     −  a grant/promotion that reached its `expiresAt` (reverses the original)
 */

export class InsufficientCreditError extends Error {
  readonly workspaceId: WorkspaceId;
  readonly balanceCents: number;
  readonly requestedCents: number;
  constructor(workspaceId: WorkspaceId, balanceCents: number, requestedCents: number) {
    super(
      `Insufficient credit: workspace ${workspaceId} has ${balanceCents}¢, requested ${requestedCents}¢.`,
    );
    this.name = "InsufficientCreditError";
    this.workspaceId = workspaceId;
    this.balanceCents = balanceCents;
    this.requestedCents = requestedCents;
  }
}

const LEDGER_COLUMNS =
  "id, workspace_id, entry_type, amount_cents, currency, reason, module_key, actor_user_id, stripe_invoice_id, stripe_refund_id, expires_at, metadata, created_at";

/** Maps a snake_case PostgREST credit_ledger row to the camelCase `CreditLedgerRow`. */
function toLedgerRow(r: {
  id: string;
  workspace_id: string;
  entry_type: CreditLedgerRow["entryType"];
  amount_cents: number;
  currency: string;
  reason: string;
  module_key: string | null;
  actor_user_id: string | null;
  stripe_invoice_id: string | null;
  stripe_refund_id: string | null;
  expires_at: string | null;
  metadata: Json | null;
  created_at: string;
}): CreditLedgerRow {
  return {
    id: branded<"CreditLedgerEntryId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    entryType: r.entry_type,
    amountCents: r.amount_cents,
    currency: r.currency,
    reason: r.reason,
    moduleKey: (r.module_key ?? null) as ModuleKey | null,
    actorUserId: r.actor_user_id ? branded<"UserId">(r.actor_user_id) : null,
    stripeInvoiceId: r.stripe_invoice_id,
    stripeRefundId: r.stripe_refund_id,
    expiresAt: r.expires_at ? parsePgTimestamp(r.expires_at) : null,
    metadata: r.metadata,
    createdAt: parsePgTimestamp(r.created_at),
  };
}

/**
 * The derived credit balance for a workspace (in cents). Always computed - never
 * stored. Returns 0 when no ledger rows exist. PostgREST exposes no `SUM` aggregate
 * (only `count` via `head`), so the balance is reduced client-side over the
 * `amount_cents` column - the ledger is append-only with integer cents, so this is
 * an exact sum (and the authoritative atomic balance check lives in the
 * `consume_credit` RPC, not here).
 */
export async function getCreditBalance(
  workspaceId: WorkspaceId,
  currency = "AUD",
): Promise<number> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("credit_ledger")
      .select("amount_cents")
      .eq("workspace_id", workspaceId)
      .eq("currency", currency),
  );
  return rows.reduce((sum, r) => sum + r.amount_cents, 0);
}

/** Internal: append a ledger row. The only mutator; never exposed publicly. */
async function appendCreditEntry(
  workspaceId: WorkspaceId,
  entryType: "grant" | "consumption" | "refund" | "adjustment" | "promotion" | "expired",
  input: CreditEntryInput,
): Promise<CreditLedgerEntryId> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("credit_ledger")
      .insert({
        workspace_id: workspaceId,
        entry_type: entryType,
        amount_cents: input.amountCents,
        currency: input.currency ?? "AUD",
        reason: input.reason,
        module_key: input.moduleKey ?? null,
        actor_user_id: input.actorUserId ?? null,
        stripe_invoice_id: input.stripeInvoiceId ?? null,
        stripe_refund_id: input.stripeRefundId ?? null,
        expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
        metadata: (input.metadata ?? null) as Json,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to append credit ledger entry.");
  return branded<"CreditLedgerEntryId">(row.id);
}

/** Issue credit to a workspace (Stripe prepayment, etc.). Optional `expiresAt`. */
export async function grantCredit(
  workspaceId: WorkspaceId,
  input: CreditEntryInput,
  actorUserId?: UserId,
): Promise<CreditEntryResult> {
  if (input.amountCents <= 0) throw new Error("grantCredit requires a positive amount.");
  const balanceBefore = await getCreditBalance(workspaceId, input.currency ?? "AUD");
  const entryId = await appendCreditEntry(workspaceId, "grant", input);
  await publishEvent({
    type: "CreditIssued",
    workspaceId,
    actorUserId,
    entityType: "credit",
    entityId: entryId,
    metadata: {
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      reason: input.reason,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId,
    action: "credit.grant",
    targetType: "credit",
    targetId: entryId,
    metadata: { amountCents: input.amountCents, reason: input.reason, moduleKey: input.moduleKey },
  });
  return { entryId, balanceCents: balanceBefore + input.amountCents };
}

/**
 * Issue promotional credit to a workspace (brief §10.7 - `PromotionApplied` is a
 * distinct ledger type from a plain grant). Same balance semantics as
 * {@link grantCredit}; optional `expiresAt` lets the credit-expired cron reverse
 * it when it lapses. Publishes `CreditIssued` (a promotion is still a credit
 * issuance from the activity-feed's perspective) and audits
 * `credit.grant.promotion`.
 */
export async function grantPromotionalCredit(
  workspaceId: WorkspaceId,
  input: CreditEntryInput,
  actorUserId?: UserId,
): Promise<CreditEntryResult> {
  if (input.amountCents <= 0) throw new Error("grantPromotionalCredit requires a positive amount.");
  const balanceBefore = await getCreditBalance(workspaceId, input.currency ?? "AUD");
  const entryId = await appendCreditEntry(workspaceId, "promotion", input);
  await publishEvent({
    type: "CreditIssued",
    workspaceId,
    actorUserId,
    entityType: "credit",
    entityId: entryId,
    metadata: {
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      reason: input.reason,
      promotion: true,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId,
    action: "credit.grant.promotion",
    targetType: "credit",
    targetId: entryId,
    metadata: { amountCents: input.amountCents, reason: input.reason, moduleKey: input.moduleKey },
  });
  return { entryId, balanceCents: balanceBefore + input.amountCents };
}

/**
 * Consume credit against a charge. Throws `InsufficientCreditError` if the
 * workspace's balance would go below zero. The balance check + insert run in the
 * `consume_credit` PL/pgSQL RPC, which locks the workspace row `FOR UPDATE` so a
 * concurrent consumer can't drive the balance negative: the second waits for the
 * first to commit, then sees the updated balance. The RPC raises SQLSTATE `45003` on
 * insufficient credit; on that path we re-read the balance (best available snapshot)
 * to construct an accurate `InsufficientCreditError`. `writeAudit` runs after the rpc.
 */
export async function consumeCredit(
  workspaceId: WorkspaceId,
  input: CreditEntryInput,
  actorUserId?: UserId,
): Promise<CreditEntryResult> {
  if (input.amountCents <= 0) throw new Error("consumeCredit requires a positive amount.");
  const currency = input.currency ?? "AUD";
  const supabase = getDataClient();
  const { data, error } = await rpc(supabase, "consume_credit", {
    p_workspace_id: workspaceId,
    p_amount_cents: input.amountCents,
    p_currency: currency,
    p_reason: input.reason,
    p_module_key: input.moduleKey ?? null,
    p_actor_user_id: actorUserId ?? null,
    p_stripe_invoice_id: input.stripeInvoiceId ?? null,
    p_metadata: input.metadata ?? null,
  });
  if (error) {
    // Overdraft guard tripped (concurrent consume, or the pre-read balance was already
    // too low). Re-read for an accurate InsufficientCreditError snapshot.
    if (error.code === "45003") {
      const balance = await getCreditBalance(workspaceId, currency);
      throw new InsufficientCreditError(workspaceId, balance, input.amountCents);
    }
    throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  }
  const row = data?.[0];
  if (!row) throw new Error("Failed to append credit ledger entry.");
  const entryId = branded<"CreditLedgerEntryId">(row.entry_id);
  const balanceCents = row.balance_cents;
  await writeAudit({
    workspaceId,
    actorUserId,
    action: "credit.consume",
    targetType: "credit",
    targetId: entryId,
    metadata: { amountCents: input.amountCents, reason: input.reason, moduleKey: input.moduleKey },
  });
  return { entryId, balanceCents };
}

/** Restore credit when a module is cancelled mid-cycle (called by the 4c cancellation engine). */
export async function refundCredit(
  workspaceId: WorkspaceId,
  input: CreditEntryInput,
  actorUserId?: UserId,
): Promise<CreditEntryResult> {
  if (input.amountCents <= 0) throw new Error("refundCredit requires a positive amount.");
  const balanceBefore = await getCreditBalance(workspaceId, input.currency ?? "AUD");
  const entryId = await appendCreditEntry(workspaceId, "refund", input);
  await publishEvent({
    type: "RefundIssued",
    workspaceId,
    actorUserId,
    entityType: "credit",
    entityId: entryId,
    metadata: {
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      reason: input.reason,
      moduleKey: input.moduleKey,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId,
    action: "credit.refund",
    targetType: "credit",
    targetId: entryId,
    metadata: { amountCents: input.amountCents, reason: input.reason, moduleKey: input.moduleKey },
  });
  return { entryId, balanceCents: balanceBefore + input.amountCents };
}

/**
 * Manual admin adjustment (signed). Positive adjustments also emit
 * `CreditIssued`; negative adjustments audit only (no activity event - a
 * deduction is internal bookkeeping, not a user-facing credit grant).
 */
export async function adjustCredit(
  workspaceId: WorkspaceId,
  input: CreditEntryInput,
  actorUserId?: UserId,
): Promise<CreditEntryResult> {
  if (input.amountCents === 0) throw new Error("adjustCredit requires a non-zero amount.");
  const balanceBefore = await getCreditBalance(workspaceId, input.currency ?? "AUD");
  const entryId = await appendCreditEntry(workspaceId, "adjustment", input);
  if (input.amountCents > 0) {
    await publishEvent({
      type: "CreditIssued",
      workspaceId,
      actorUserId,
      entityType: "credit",
      entityId: entryId,
      metadata: {
        amountCents: input.amountCents,
        currency: input.currency ?? "AUD",
        reason: input.reason,
      },
    });
  }
  await writeAudit({
    workspaceId,
    actorUserId,
    action: "credit.adjust",
    targetType: "credit",
    targetId: entryId,
    metadata: { amountCents: input.amountCents, reason: input.reason },
  });
  return { entryId, balanceCents: balanceBefore + input.amountCents };
}

/**
 * List a workspace's ledger entries, newest-first. Workspace-isolated (IDOR-safe)
 * - only rows for `workspaceId` are ever returned.
 */
export async function listCreditLedger(
  workspaceId: WorkspaceId,
  opts?: { limit?: number },
): Promise<CreditLedgerRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 50, 200);
  const rows = await unwrap(
    supabase
      .from("credit_ledger")
      .select(LEDGER_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
  );
  return rows.map(toLedgerRow);
}

/**
 * Reverse grant/promotion rows whose `expiresAt` has passed (brief §10.7 -
 * `CreditExpired`). For each due entry, append a negative `expired` row that
 * references the original via `metadata.originalEntryId`; the balance (derived
 * `SUM`) drops automatically. Idempotent: a pre-check plus the
 * `credit_ledger_expired_original_unique` partial unique index guarantee one
 * expired row per original even under concurrent cron runs. Returns the count
 * of newly-expired entries. Best-effort per entry - a failure on one row logs
 * and continues to the next.
 */
export async function markExpiredCredits(now: Date = new Date()): Promise<number> {
  const supabase = getDataClient();
  const due = await unwrap(
    supabase
      .from("credit_ledger")
      .select(LEDGER_COLUMNS)
      .in("entry_type", ["grant", "promotion"])
      .lte("expires_at", now.toISOString()),
  );

  let expired = 0;
  for (const entry of due) {
    const row = toLedgerRow(entry);
    const originalEntryId = String(row.id);
    // Idempotency pre-check: skip if an `expired` row already references this grant.
    // PostgREST jsonb access: `metadata->>originalEntryId` extracts the key as text,
    // compared with `eq` against the original id string.
    const existing = await unwrapMaybe(
      supabase
        .from("credit_ledger")
        .select("id")
        .eq("workspace_id", row.workspaceId)
        .eq("entry_type", "expired")
        .filter("metadata->>originalEntryId", "eq", originalEntryId)
        .limit(1)
        .maybeSingle(),
    );
    if (existing) continue;

    try {
      await appendCreditEntry(row.workspaceId, "expired", {
        amountCents: -row.amountCents, // reverse the original grant/promotion
        currency: row.currency,
        reason: "credit.expired",
        metadata: { originalEntryId },
      });
      await publishEvent({
        type: "CreditExpired",
        workspaceId: row.workspaceId,
        entityType: "credit",
        entityId: originalEntryId,
        metadata: { originalEntryId, amountCents: row.amountCents, currency: row.currency },
      });
      await writeAudit({
        workspaceId: row.workspaceId,
        action: "credit.expire",
        targetType: "credit",
        targetId: originalEntryId,
        metadata: { originalEntryId, amountCents: row.amountCents },
      });
      expired += 1;
    } catch (err) {
      // The partial unique index is the race-safe backstop - a concurrent expire
      // hitting the same grant throws here; log and continue.
      console.error("[credits] failed to expire entry", { originalEntryId, err });
    }
  }
  return expired;
}
