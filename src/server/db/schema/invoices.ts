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
import type { CustomerId, InvoiceId, InvoiceLineItemId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { customers } from "./customers";
import { invoiceStatusEnum } from "./enums";

/**
 * Invoices module schema (Phase 5). One `invoices` row per document, workspace-scoped;
 * `invoice_line_items` are the billed rows. Totals (`subtotalCents`/`taxCents`/
 * `totalCents`) are denormalized onto the invoice row so a sent invoice's history is
 * preserved even if line items are later edited on a different draft.
 *
 * Status flow (Phase 5a): `draft → sent → paid | void`. `viewed` (5b public-page view
 * tracker) and `overdue` (5b reminder job) are unreachable in 5a — they exist in the enum
 * so 5b adds no migration. `publicToken` is set on send (a signed random token for the 5b
 * public payment page `/i/[token]`); the partial unique index keeps it unguessable and
 * allows nulls (drafts) without collision.
 *
 * Money is integer cents throughout. `quantity` is a decimal (hours, units) stored as
 * numeric(12,2); `amountCents` is `round(quantity * unitPriceCents)` denormalized.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().$type<InvoiceId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Nullable — walk-in invoices (no customer record) are allowed. */
    customerId: uuid("customer_id")
      .$type<CustomerId>()
      .references(() => customers.id),
    /** Human-readable, workspace-unique number, e.g. `INV-2026-0001`. */
    number: text("number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issueDate: timestamp("issue_date").defaultNow().notNull(),
    dueDate: timestamp("due_date"),
    currency: text("currency").notNull().default("AUD"),
    /** Tax rate as an integer percent (10 = 10% GST). 0 = tax-free. */
    taxRate: integer("tax_rate").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /** Private note visible only to the workspace, not the customer. */
    notes: text("notes"),
    /** Signed random token for the 5b public payment page. Set on send. */
    publicToken: text("public_token"),
    sentAt: timestamp("sent_at"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Numbers are unique per workspace (INV-2026-0001 can't repeat within one workspace).
    uniqueIndex("invoices_workspace_number_unique").on(t.workspaceId, t.number),
    index("invoices_workspace_status_idx").on(t.workspaceId, t.status),
    index("invoices_workspace_customer_idx").on(t.workspaceId, t.customerId),
    // Public token must be unguessable + unique; partial so drafts (null) don't collide.
    uniqueIndex("invoices_public_token_unique")
      .on(t.publicToken)
      .where(sql`public_token IS NOT NULL`),
  ],
);

/**
 * Line items for an invoice. `workspaceId` is denormalized so isolation queries can filter
 * without a join. `amountCents` is denormalized (= round(quantity * unitPriceCents)) so
 * the historical amount is preserved. Cascade-deleted with the parent invoice.
 */
export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().$type<InvoiceLineItemId>().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoices.id, { onDelete: "cascade" }),
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
    /** Display order within the invoice. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("invoice_line_items_invoice_idx").on(t.invoiceId, t.position)],
);
