import "server-only";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { creditLedger } from "@/server/db/schema";
import type { CreditLedgerEntryId, UserId, WorkspaceId } from "@/shared/types/ids";
import type { ModuleKey } from "@/shared/constants/modules";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";

/**
 * Credit ledger service (brief §4 — "credit ledger, never a mutable balance").
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

export interface CreditEntryInput {
  amountCents: number;
  currency?: string;
  reason: string;
  moduleKey?: ModuleKey;
  actorUserId?: UserId;
  stripeInvoiceId?: string;
  stripeRefundId?: string;
  /** Optional expiry — only meaningful for grant/promotion rows. */
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface CreditLedgerRow {
  id: CreditLedgerEntryId;
  workspaceId: WorkspaceId;
  entryType: "grant" | "consumption" | "refund" | "adjustment" | "promotion" | "expired";
  amountCents: number;
  currency: string;
  reason: string;
  moduleKey: ModuleKey | null;
  actorUserId: UserId | null;
  stripeInvoiceId: string | null;
  stripeRefundId: string | null;
  expiresAt: Date | null;
  /** Drizzle infers jsonb columns as `unknown`; callers cast at the use site. */
  metadata: unknown;
  createdAt: Date;
}

export interface CreditEntryResult {
  entryId: CreditLedgerEntryId;
  /** Balance after this entry (derived: balanceBefore + amountCents). */
  balanceCents: number;
}

const selectRow = {
  id: creditLedger.id,
  workspaceId: creditLedger.workspaceId,
  entryType: creditLedger.entryType,
  amountCents: creditLedger.amountCents,
  currency: creditLedger.currency,
  reason: creditLedger.reason,
  moduleKey: creditLedger.moduleKey,
  actorUserId: creditLedger.actorUserId,
  stripeInvoiceId: creditLedger.stripeInvoiceId,
  stripeRefundId: creditLedger.stripeRefundId,
  expiresAt: creditLedger.expiresAt,
  metadata: creditLedger.metadata,
  createdAt: creditLedger.createdAt,
} as const;

/**
 * The derived credit balance for a workspace (in cents). Always computed — never
 * stored. Returns 0 when no ledger rows exist.
 */
export async function getCreditBalance(
  workspaceId: WorkspaceId,
  currency = "AUD",
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.amountCents}), 0)::int` })
    .from(creditLedger)
    .where(and(eq(creditLedger.workspaceId, workspaceId), eq(creditLedger.currency, currency)))
    .limit(1);
  return Number(rows[0]?.balance ?? 0);
}

/** Internal: append a ledger row. The only mutator; never exposed publicly. */
async function appendCreditEntry(
  workspaceId: WorkspaceId,
  entryType: "grant" | "consumption" | "refund" | "adjustment" | "promotion" | "expired",
  input: CreditEntryInput,
): Promise<CreditLedgerEntryId> {
  const db = getDb();
  const rows = await db
    .insert(creditLedger)
    .values({
      workspaceId,
      entryType,
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      reason: input.reason,
      moduleKey: input.moduleKey ?? null,
      actorUserId: input.actorUserId ?? null,
      stripeInvoiceId: input.stripeInvoiceId ?? null,
      stripeRefundId: input.stripeRefundId ?? null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? null,
    })
    .returning({ id: creditLedger.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to append credit ledger entry.");
  return row.id;
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
 * Issue promotional credit to a workspace (brief §10.7 — `PromotionApplied` is a
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
 * workspace's balance would go below zero. The balance check + insert run in a
 * single transaction so a concurrent consumer can't drive the balance negative.
 */
export async function consumeCredit(
  workspaceId: WorkspaceId,
  input: CreditEntryInput,
  actorUserId?: UserId,
): Promise<CreditEntryResult> {
  if (input.amountCents <= 0) throw new Error("consumeCredit requires a positive amount.");
  const currency = input.currency ?? "AUD";
  const db = getDb();
  const { entryId, balanceCents } = await db.transaction(async (tx) => {
    const balanceRows = await tx
      .select({ balance: sql<number>`coalesce(sum(${creditLedger.amountCents}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.workspaceId, workspaceId), eq(creditLedger.currency, currency)))
      .limit(1);
    const balance = Number(balanceRows[0]?.balance ?? 0);
    if (balance - input.amountCents < 0) {
      throw new InsufficientCreditError(workspaceId, balance, input.amountCents);
    }
    const rows = await tx
      .insert(creditLedger)
      .values({
        workspaceId,
        entryType: "consumption",
        amountCents: -input.amountCents,
        currency,
        reason: input.reason,
        moduleKey: input.moduleKey ?? null,
        actorUserId: actorUserId ?? null,
        stripeInvoiceId: input.stripeInvoiceId ?? null,
        metadata: input.metadata ?? null,
      })
      .returning({ id: creditLedger.id });
    const id = rows[0]?.id;
    if (!id) throw new Error("Failed to append credit ledger entry.");
    return { entryId: id, balanceCents: balance - input.amountCents };
  });
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
 * `CreditIssued`; negative adjustments audit only (no activity event — a
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
 * — only rows for `workspaceId` are ever returned.
 */
export async function listCreditLedger(
  workspaceId: WorkspaceId,
  opts?: { limit?: number },
): Promise<CreditLedgerRow[]> {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 50, 200);
  return db
    .select(selectRow)
    .from(creditLedger)
    .where(eq(creditLedger.workspaceId, workspaceId))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit);
}

/**
 * Reverse grant/promotion rows whose `expiresAt` has passed (brief §10.7 —
 * `CreditExpired`). For each due entry, append a negative `expired` row that
 * references the original via `metadata.originalEntryId`; the balance (derived
 * `SUM`) drops automatically. Idempotent: a pre-check plus the
 * `credit_ledger_expired_original_unique` partial unique index guarantee one
 * expired row per original even under concurrent cron runs. Returns the count
 * of newly-expired entries. Best-effort per entry — a failure on one row logs
 * and continues to the next.
 */
export async function markExpiredCredits(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const due = await db
    .select(selectRow)
    .from(creditLedger)
    .where(
      and(
        inArray(creditLedger.entryType, ["grant", "promotion"]),
        lte(creditLedger.expiresAt, now),
      ),
    );

  let expired = 0;
  for (const entry of due) {
    const originalEntryId = String(entry.id);
    // Idempotency pre-check: skip if an `expired` row already references this grant.
    const existing = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.workspaceId, entry.workspaceId),
          eq(creditLedger.entryType, "expired"),
          sql`${creditLedger.metadata}->>'originalEntryId' = ${originalEntryId}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    try {
      await appendCreditEntry(entry.workspaceId, "expired", {
        amountCents: -entry.amountCents, // reverse the original grant/promotion
        currency: entry.currency,
        reason: "credit.expired",
        metadata: { originalEntryId },
      });
      await publishEvent({
        type: "CreditExpired",
        workspaceId: entry.workspaceId,
        entityType: "credit",
        entityId: originalEntryId,
        metadata: { originalEntryId, amountCents: entry.amountCents, currency: entry.currency },
      });
      await writeAudit({
        workspaceId: entry.workspaceId,
        action: "credit.expire",
        targetType: "credit",
        targetId: originalEntryId,
        metadata: { originalEntryId, amountCents: entry.amountCents },
      });
      expired += 1;
    } catch (err) {
      // The partial unique index is the race-safe backstop — a concurrent expire
      // hitting the same grant throws here; log and continue.
      console.error("[credits] failed to expire entry", { originalEntryId, err });
    }
  }
  return expired;
}
