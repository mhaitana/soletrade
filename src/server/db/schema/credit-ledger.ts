import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/pg-core";
import type { CreditLedgerEntryId, UserId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { creditEntryTypeEnum, moduleKeyEnum } from "./enums";

/**
 * Credit ledger — append-only (brief §4). The workspace's credit balance is
 * ALWAYS the derived `SUM(amount_cents)` over these rows, never a mutable
 * column. Entries are signed: grants/refunds/positive-adjustments are positive;
 * consumption/negative-adjustments are negative. No `updatedAt`, no `deletedAt`
 * — nothing here is ever modified or removed.
 *
 *   grant       — credit issued to the workspace (Stripe prepayment, etc.)
 *   promotion   — promotional credit issued (distinct from grant per brief §10.7)
 *   consumption — credit applied to a charge (e.g. an invoice in Phase 5)
 *   refund      — credit restored when a module is cancelled mid-cycle (4c)
 *   adjustment  — manual admin ±
 *   expired     — a grant/promotion that reached its `expiresAt` (negative; reverses
 *                 the original). `metadata.originalEntryId` links back to the grant.
 *
 * `expiresAt` is nullable and only set on grant/promotion rows that should expire.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().$type<CreditLedgerEntryId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    entryType: creditEntryTypeEnum("entry_type").notNull(),
    /** Signed integer cents. Positive for grant/promotion/refund/adj-add, negative for consumption/expired/adj-remove. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("AUD"),
    /** Short dotted reason code, e.g. "module.cancel.refund", "promotional.grant". */
    reason: text("reason").notNull(),
    moduleKey: moduleKeyEnum("module_key"),
    actorUserId: uuid("actor_user_id").$type<UserId>(),
    /** Stripe links for reconciliation (populated in 4b/4c when a charge/refund is involved). */
    stripeInvoiceId: text("stripe_invoice_id"),
    stripeRefundId: text("stripe_refund_id"),
    /**
     * Optional expiry timestamp — only set on grant/promotion rows that should
     * expire. The credit-expired cron appends a matching `expired` row when this
     * passes; `getCreditBalance` already sums signed amounts so the balance drops.
     */
    expiresAt: timestamp("expires_at"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("credit_ledger_workspace_created_idx").on(t.workspaceId, t.createdAt),
    // Partial unique index so a duplicate `invoice.paid` delivery (different Stripe event
    // id, same invoice) can never double-grant credits. The caller-level check is the
    // primary guard; this is DB-level defense-in-depth. Nullable column → partial index
    // (NULLs are excluded so non-Stripe ledger rows don't collide).
    uniqueIndex("credit_ledger_stripe_invoice_unique")
      .on(t.workspaceId, t.stripeInvoiceId)
      .where(sql`stripe_invoice_id IS NOT NULL`),
    // Race-safe idempotency for credit expiry: at most one `expired` row per original
    // grant/promotion entry. Expression index on the jsonb `originalEntryId` metadata
    // link, scoped to `expired` rows. The caller-level pre-check is the primary guard.
    uniqueIndex("credit_ledger_expired_original_unique")
      .on(t.workspaceId, sql`(metadata->>'originalEntryId')`)
      .where(sql`entry_type = 'expired'`),
  ],
);
