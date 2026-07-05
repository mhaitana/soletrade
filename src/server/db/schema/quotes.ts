import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  CustomerId,
  InvoiceId,
  QuoteId,
  QuoteLineItemId,
  WorkspaceId,
} from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { customers } from "./customers";
import { quoteStatusEnum } from "./enums";

/**
 * Quotes module schema (Phase 8) — the fourth and final launch module. A quote is a
 * proposal sent to a customer: the merchant drafts it, sends a shareable public link,
 * the customer accepts or declines, and on acceptance the merchant converts it to a
 * draft invoice. Mirrors `invoices.ts` (line items, totals, customer link, public token,
 * numbering) but has **no Stripe payment columns** (quotes aren't paid; they're accepted
 * then converted).
 *
 * Status flow: `draft → sent → viewed → (accepted | declined | expired)`; `accepted →
 * converted` (terminal). `viewed` is set by the public-page view tracker (sent → viewed,
 * idempotent). `expired` is set by the quote-expired cron for sent/viewed quotes past
 * `validUntil`. `publicToken` is set on send (unguessable per-document credential for
 * `/q/[token]`); the partial unique index keeps it unique and allows nulls (drafts).
 * `convertedInvoiceId` is a nullable **no-FK** link to the invoices table (Books-style
 * decoupled link so the quotes table doesn't hard-depend on the invoices table; the
 * convert action writes it after `createInvoice` succeeds).
 *
 * Money is integer cents throughout. `quantity` is a decimal (hours, units) stored as
 * numeric(12,2); `amountCents` is `round(quantity * unitPriceCents)` denormalized.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().$type<QuoteId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Nullable — walk-in quotes (no customer record) are allowed, mirroring invoices. */
    customerId: uuid("customer_id")
      .$type<CustomerId>()
      .references(() => customers.id),
    /** Human-readable, workspace-unique number, e.g. `QUO-2026-0001`. */
    number: text("number").notNull(),
    status: quoteStatusEnum("status").notNull().default("draft"),
    issueDate: timestamp("issue_date").defaultNow().notNull(),
    /** Quote validity deadline — past this, sent/viewed quotes auto-expire via cron. */
    validUntil: timestamp("valid_until"),
    currency: text("currency").notNull().default("AUD"),
    /** Tax rate as an integer percent (10 = 10% GST). 0 = tax-free. */
    taxRate: integer("tax_rate").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /** Private note visible only to the workspace, not the customer. */
    notes: text("notes"),
    /** Unguessable per-document token for the public /q/[token] page. Set on send. */
    publicToken: text("public_token"),
    sentAt: timestamp("sent_at"),
    acceptedAt: timestamp("accepted_at"),
    declinedAt: timestamp("declined_at"),
    convertedAt: timestamp("converted_at"),
    /**
     * The draft invoice created from this quote on convert. No FK — the quotes table
     * doesn't hard-depend on the invoices table (mirrors `sourceInvoiceId` on
     * book_transactions). Written by the convert action after `createInvoice` succeeds.
     */
    convertedInvoiceId: uuid("converted_invoice_id").$type<InvoiceId>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Numbers are unique per workspace (QUO-2026-0001 can't repeat within one workspace).
    uniqueIndex("quotes_workspace_number_unique").on(t.workspaceId, t.number),
    index("quotes_workspace_status_idx").on(t.workspaceId, t.status),
    index("quotes_workspace_customer_idx").on(t.workspaceId, t.customerId),
    // Public token must be unguessable + unique; partial so drafts (null) don't collide.
    uniqueIndex("quotes_public_token_unique")
      .on(t.publicToken)
      .where(sql`public_token IS NOT NULL`),
  ],
);

/**
 * Line items for a quote. `workspaceId` is denormalized so isolation queries can filter
 * without a join. `amountCents` is denormalized (= round(quantity * unitPriceCents)) so
 * the historical amount is preserved. Cascade-deleted with the parent quote.
 */
export const quoteLineItems = pgTable(
  "quote_line_items",
  {
    id: uuid("id").primaryKey().$type<QuoteLineItemId>().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .$type<QuoteId>()
      .references(() => quotes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    description: text("description").notNull(),
    /** Decimal quantity (hours, units). numeric(12,2) — e.g. 2.5 hours. */
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** Denormalized = round(quantity * unitPriceCents). */
    amountCents: integer("amount_cents").notNull(),
    /** Display order within the quote. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("quote_line_items_quote_idx").on(t.quoteId, t.position)],
);
