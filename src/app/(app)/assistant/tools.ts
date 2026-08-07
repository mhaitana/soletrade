import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { authorize, type Permission } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import type { WorkspaceContext } from "@/platform/context";
import {
  createCustomer,
  getCustomer,
  getCustomerByEmail,
  listCustomers,
  updateCustomer,
} from "@/platform/customers";
import { writeAudit } from "@/platform/audit";
import { listActivity } from "@/platform/activity";
import { getWorkspace } from "@/platform/workspaces";
import {
  createInvoice,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  sendInvoice,
  summarizeInvoices,
  voidInvoice,
} from "@/modules/invoices";
import {
  createQuote,
  getQuote,
  listQuotes,
  markQuoteConverted,
  summarizeQuotes,
} from "@/modules/quotes";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  summarizeTransactions,
  updateTransaction,
} from "@/modules/books";
import { extractReceipt } from "@/modules/books/receipt-extraction";
import {
  createEarning,
  createExpense,
  createTrip,
  listEarnings,
  listVehicles,
  summarizeDrive,
} from "@/modules/drive";
import { consolidateBusinessIncome } from "@/app/(app)/dashboard/business-overview";
import { categoriesForType } from "@/shared/constants/books-categories";
import { DRIVE_PLATFORMS, isDrivePlatform } from "@/shared/constants/drive-platforms";
import type { ModuleKey } from "@/shared/constants/modules";
import { periodRange } from "@/shared/utils/periods";
import {
  branded,
  type CustomerId,
  type InvoiceId,
  type QuoteId,
  type VehicleId,
  type WorkspaceId,
} from "@/shared/types/ids";

/**
 * Workspace-aware read-only tools for the AI assistant (Phase 10). This is the
 * **composition layer** - it lives in the app layer (not `src/platform/ai`)
 * precisely because it imports module services, which the platform layer is
 * forbidden from doing. The route handler resolves the workspace context,
 * fetches the installed-module list, builds these tools (closured over the
 * context), and hands them to `streamAssistant`.
 *
 * Fail-closed: a tool the user can't use (no `view:R` grant, or its module
 * isn't installed) is **not offered** to the model. Each `execute` re-checks
 * the gate too - defence in depth - and returns a trimmed, JSON-serializable
 * shape (money as integer cents + currency; the model formats for display).
 */

/** Trim a Date to an ISO string for JSON-serializable tool output. */
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Cap + clamp a `limit` argument the model may pass. */
const clampLimit = (n: number | undefined, def: number, max: number): number =>
  Math.min(Math.max(typeof n === "number" ? Math.trunc(n) : def, 1), max);

/**
 * Resolve a customer reference (id or email) to an active customer id for the
 * invoice/quote write tools. **Email is the preferred, stable reference** - the
 * model carries it as plain text (e.g. "amos@miruku.com") where it can't
 * reliably transcribe a 36-char uuid across turns. Returns the resolved id,
 * `null` for a walk-in (no ref), or a friendly `error` the model can recover
 * from (offer to create the customer, or call listCustomers for the current id)
 * instead of the raw "Customer not found in this workspace." assert throw.
 */
async function resolveCustomerId(
  workspaceId: WorkspaceId,
  ref: { customerId?: string; customerEmail?: string },
): Promise<{ id: CustomerId | null; error?: string }> {
  if (ref.customerId) {
    const existing = await getCustomer(workspaceId, branded<"CustomerId">(ref.customerId));
    if (!existing) {
      return {
        id: null,
        error:
          "I couldn't find that customer - the id may be stale. Call listCustomers to get the current id, or pass the customer's email via customerEmail instead.",
      };
    }
    return { id: existing.id };
  }
  if (ref.customerEmail) {
    const existing = await getCustomerByEmail(workspaceId, ref.customerEmail);
    if (!existing) {
      return {
        id: null,
        error: `I couldn't find a customer with email ${ref.customerEmail} in this workspace. Want me to create them first?`,
      };
    }
    return { id: existing.id };
  }
  return { id: null };
}

/**
 * Resolve a human-meaningful document number (e.g. "INV-2026-0007") to the matching
 * invoice row. Mirrors the email-resolution philosophy: the model carries a short,
 * stable number the user actually said, never a 36-char uuid. Reuses `listInvoices`
 * search (which matches the number column) then exact-matches `number` to avoid
 * substring ambiguity. Returns the row or `null`.
 */
async function resolveInvoiceByNumber(
  workspaceId: WorkspaceId,
  number: string,
): Promise<{ id: InvoiceId; number: string } | null> {
  const rows = await listInvoices(workspaceId, { search: number, limit: 200 });
  const match = rows.find((r) => r.number === number);
  return match ? { id: match.id, number: match.number } : null;
}

/** Resolve a quote number (e.g. "QUO-2026-0003") to the matching quote row. */
async function resolveQuoteByNumber(
  workspaceId: WorkspaceId,
  number: string,
): Promise<{ id: QuoteId; number: string } | null> {
  const rows = await listQuotes(workspaceId, { search: number, limit: 200 });
  const match = rows.find((r) => r.number === number);
  return match ? { id: match.id, number: match.number } : null;
}

export interface WorkspaceOverview {
  installedModules: readonly ModuleKey[];
  currency: string;
  kpis: {
    cashCents: number | null;
    outstandingCents: number | null;
    overdueInvoiceCount: number | null;
    incomeCents: number | null;
    revenueCents: number | null;
    pendingQuotesCents: number | null;
  };
  recentActivity:
    | {
        type: string;
        entityType: string | null;
        createdAt: string | null;
        actorFullName: string | null;
      }[]
    | null;
}

/**
 * Compute the workspace overview (current-month KPIs + recent activity). Shared by
 * the `getWorkspaceOverview` tool and the mock-provider reply. Returns `null` for
 * any KPI whose module isn't installed or that the user can't `view`. The activity
 * slice is `null` when the user lacks `view:activity`.
 */
export async function computeWorkspaceOverview(
  ctx: WorkspaceContext,
  installedModules: readonly ModuleKey[],
): Promise<WorkspaceOverview> {
  const { workspaceId, role } = ctx;
  const can = (perm: Permission) => authorize(role, perm).ok;
  const hasModule = (key: ModuleKey) => installedModules.includes(key);
  const range = periodRange("month");

  const [workspace, booksRows, invoiceRows, driveRows, quoteRows, activityPage] = await Promise.all(
    [
      getWorkspace(workspaceId),
      hasModule("books") && can("view:books")
        ? listTransactions(workspaceId, {
            dateFrom: range.start ?? undefined,
            dateTo: range.end,
            limit: 2000,
          })
        : Promise.resolve(null),
      hasModule("invoices") && can("view:invoice")
        ? listInvoices(workspaceId, { limit: 200 })
        : Promise.resolve(null),
      hasModule("drive") && can("view:drive")
        ? listEarnings(workspaceId, {
            dateFrom: range.start ?? undefined,
            dateTo: range.end,
            limit: 2000,
          })
        : Promise.resolve(null),
      hasModule("quotes") && can("view:quote")
        ? listQuotes(workspaceId, { limit: 200 })
        : Promise.resolve(null),
      can("view:activity") ? listActivity(workspaceId, { limit: 5 }) : Promise.resolve(null),
    ],
  );

  const booksSummary = booksRows ? summarizeTransactions(booksRows) : null;
  const invoiceSummary = invoiceRows ? summarizeInvoices(invoiceRows, range) : null;
  const driveSummary = driveRows ? summarizeDrive(driveRows, []) : null;
  const quoteSummary = quoteRows ? summarizeQuotes(quoteRows, range) : null;
  const totalIncome = consolidateBusinessIncome({
    books: booksSummary ? { currentCents: booksSummary.incomeCents, previousCents: null } : null,
    invoices: invoiceSummary
      ? { currentCents: invoiceSummary.paidCents, previousCents: null }
      : null,
    drive: driveSummary
      ? { currentCents: driveSummary.totalEarningsCents, previousCents: null }
      : null,
  });

  return {
    installedModules,
    currency: workspace?.defaultCurrency ?? "AUD",
    kpis: {
      cashCents: booksSummary?.netCents ?? null,
      outstandingCents: invoiceSummary?.outstandingCents ?? null,
      overdueInvoiceCount: invoiceSummary?.overdueCount ?? null,
      incomeCents: totalIncome.source ? totalIncome.currentCents : null,
      revenueCents: invoiceSummary?.paidCents ?? null,
      pendingQuotesCents: quoteSummary?.acceptedValueCents ?? null,
    },
    recentActivity:
      activityPage?.items.map((a) => ({
        type: a.type,
        entityType: a.entityType,
        createdAt: iso(a.createdAt),
        actorFullName: a.actorFullName,
      })) ?? null,
  };
}

/**
 * Build the assistant's tool set for the given context + installed modules.
 * Only permitted, installed tools are included - the record may be empty for
 * a fresh workspace with no modules (the model then answers from the system
 * prompt alone, or via `getWorkspaceOverview` which is always offered).
 *
 * Write tools (Phase 11d) are offered ONLY when `opts.writeEnabled` is true - the
 * per-conversation opt-in flag is the hard safety boundary. Even then each write
 * tool is fail-closed on `manage:R` + module-install, and `execute` re-checks
 * `manage:R` (defense in depth - the closure could be stale if the flag toggled).
 * The system prompt instructs the model to state exactly what it will create and
 * ask the user to confirm before calling a write tool (human-in-the-loop via
 * turn-taking, persisted in `ai_messages`).
 */
export function buildAssistantTools(
  ctx: WorkspaceContext,
  installedModules: readonly ModuleKey[],
  opts: { writeEnabled?: boolean } = {},
): ToolSet {
  const { workspaceId, role, user } = ctx;
  const can = (perm: Permission) => authorize(role, perm).ok;
  const hasModule = (key: ModuleKey) => installedModules.includes(key);
  const writeEnabled = opts.writeEnabled === true;

  const tools: ToolSet = {};

  // 1. Workspace overview - always offered; returns nulls for uninstalled modules.
  tools.getWorkspaceOverview = tool({
    description:
      "Get a high-level overview of the workspace: installed modules, current-month total income across Books/Invoices/Drive without double-counting, net cash flow, outstanding invoices, accepted quotes ready to invoice, and the 5 most recent activity events. Call this first when the user asks a broad question like 'how's my business doing'.",
    inputSchema: z.object({}),
    execute: async () => computeWorkspaceOverview(ctx, installedModules),
  });

  // 2. listInvoices - module-gated.
  if (hasModule("invoices") && can("view:invoice")) {
    tools.listInvoices = tool({
      description:
        "List invoices for the workspace, newest first. Optional filters: status (draft|sent|viewed|paid|void|overdue), a search term (matches invoice number or customer name/company), and a limit (default 20, max 200). Returns number, status, totalCents, currency, issueDate, paidAt, customerName.",
      inputSchema: z.object({
        status: z
          .enum(["draft", "sent", "viewed", "paid", "void", "overdue"])
          .optional()
          .describe("Filter by invoice status."),
        search: z
          .string()
          .optional()
          .describe("Substring match on invoice number or customer name/company."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows to return (default 20)."),
      }),
      execute: async (input) => {
        const rows = await listInvoices(workspaceId, {
          status: input.status,
          search: input.search,
          limit: clampLimit(input.limit, 20, 200),
        });
        return rows.map((r) => ({
          number: r.number,
          status: r.status,
          totalCents: r.totalCents,
          currency: r.currency,
          issueDate: iso(r.issueDate),
          paidAt: iso(r.paidAt),
          customerName: r.customerName,
        }));
      },
    });
  }

  // 3. listQuotes - module-gated.
  if (hasModule("quotes") && can("view:quote")) {
    tools.listQuotes = tool({
      description:
        "List quotes for the workspace, newest first. Optional filters: status (draft|sent|viewed|accepted|declined|expired|converted), a search term (matches quote number or customer name/company), and a limit (default 20, max 200). Returns number, status, totalCents, currency, issueDate, customerName.",
      inputSchema: z.object({
        status: z
          .enum(["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"])
          .optional()
          .describe("Filter by quote status."),
        search: z
          .string()
          .optional()
          .describe("Substring match on quote number or customer name/company."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows to return (default 20)."),
      }),
      execute: async (input) => {
        const rows = await listQuotes(workspaceId, {
          status: input.status,
          search: input.search,
          limit: clampLimit(input.limit, 20, 200),
        });
        return rows.map((r) => ({
          number: r.number,
          status: r.status,
          totalCents: r.totalCents,
          currency: r.currency,
          issueDate: iso(r.issueDate),
          customerName: r.customerName,
        }));
      },
    });
  }

  // 4. listTransactions - module-gated (Books).
  if (hasModule("books") && can("view:books")) {
    tools.listTransactions = tool({
      description:
        "List Books transactions (income/expense) for the workspace, newest first. Optional filters: type (income|expense), a search term (matches description or customer name/company), dateFrom (ISO), dateTo (ISO), and a limit (default 20, max 2000). Returns id, type, amountCents, currency, date, description, category, customerName. Use the id to update or delete a transaction.",
      inputSchema: z.object({
        type: z.enum(["income", "expense"]).optional().describe("Filter by transaction type."),
        search: z
          .string()
          .optional()
          .describe("Substring match on description or customer name/company."),
        dateFrom: z.string().datetime().optional().describe("Inclusive lower bound (ISO 8601)."),
        dateTo: z.string().datetime().optional().describe("Inclusive upper bound (ISO 8601)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Max rows to return (default 20)."),
      }),
      execute: async (input) => {
        const rows = await listTransactions(workspaceId, {
          type: input.type,
          search: input.search,
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          limit: clampLimit(input.limit, 20, 2000),
        });
        return rows.map((r) => ({
          id: r.id,
          type: r.type,
          amountCents: r.amountCents,
          currency: r.currency,
          date: iso(r.date),
          description: r.description,
          category: r.category,
          customerName: r.customerName,
        }));
      },
    });
  }

  // 5. listDriveEarnings - module-gated (Drive).
  if (hasModule("drive") && can("view:drive")) {
    tools.listDriveEarnings = tool({
      description:
        "List Drive gig earnings for the workspace, newest first. Optional filters: a search term (matches platform or description), dateFrom (ISO), dateTo (ISO), and a limit (default 20, max 2000). Returns platform, amountCents, currency, date, description.",
      inputSchema: z.object({
        search: z.string().optional().describe("Substring match on platform or description."),
        dateFrom: z.string().datetime().optional().describe("Inclusive lower bound (ISO 8601)."),
        dateTo: z.string().datetime().optional().describe("Inclusive upper bound (ISO 8601)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Max rows to return (default 20)."),
      }),
      execute: async (input) => {
        const rows = await listEarnings(workspaceId, {
          search: input.search,
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          limit: clampLimit(input.limit, 20, 2000),
        });
        return rows.map((r) => ({
          platform: r.platform,
          amountCents: r.amountCents,
          currency: r.currency,
          date: iso(r.date),
          description: r.description,
        }));
      },
    });
  }

  // 6. listCustomers - platform service, not module-gated.
  if (can("view:customer")) {
    tools.listCustomers = tool({
      description:
        "List customers for the workspace, newest first. Optional search (matches name/email/company) and a limit (default 20, max 200). Returns id, name, email, company, phone. Use the id to update a customer or attach one to an invoice/quote.",
      inputSchema: z.object({
        search: z.string().optional().describe("Substring match on name, email, or company."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows to return (default 20)."),
      }),
      execute: async (input) => {
        const rows = await listCustomers(workspaceId, {
          search: input.search,
          limit: clampLimit(input.limit, 20, 200),
        });
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          company: r.company,
          phone: r.phone,
        }));
      },
    });
  }

  // 7. listRecentActivity - platform service, not module-gated.
  if (can("view:activity")) {
    tools.listRecentActivity = tool({
      description:
        "List recent activity events for the workspace, newest first. Optional limit (default 10, max 100). Returns type, entityType, createdAt, actorFullName.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max rows to return (default 10)."),
      }),
      execute: async (input) => {
        const page = await listActivity(workspaceId, { limit: clampLimit(input.limit, 10, 100) });
        return page.items.map((a) => ({
          type: a.type,
          entityType: a.entityType,
          createdAt: iso(a.createdAt),
          actorFullName: a.actorFullName,
        }));
      },
    });
  }

  // ── Write tools (Phase 11d) ───────────────────────────────────────────────
  // Offered ONLY when the per-conversation `writeEnabled` flag is on. Each is
  // fail-closed on `manage:R` + module-install, and `execute` re-checks `manage:R`
  // (defense in depth). The services already `publishEvent` + `writeAudit` (invoices,
  // quotes, books); `createCustomer` is platform-level + event-only, so the tool
  // wraps it with `writeAudit` to keep customer creates auditable. Each returns a
  // trimmed confirmation ({ id, number? }) - never the full row.
  if (writeEnabled) {
    // 8. createCustomer - platform service, not module-gated. Needs manage:customer.
    if (can("manage:customer")) {
      tools.createCustomer = tool({
        description:
          "Create a new customer in the workspace. Use after the user confirms. If a customer with the given email already exists, returns that existing customer with `existed: true` instead of creating a duplicate - tell the user and use the returned id. Required: name. Optional: email, phone, company, notes.",
        inputSchema: z.object({
          name: z.string().min(1).max(200).describe("Customer display name."),
          email: z.string().email().optional().describe("Optional contact email."),
          phone: z.string().max(50).optional().describe("Optional phone number."),
          company: z.string().max(200).optional().describe("Optional company name."),
          notes: z.string().max(2000).optional().describe("Optional free-form notes."),
        }),
        execute: async (input) => {
          // Re-check the gate inside execute (defense in depth).
          if (!(await authorizeOrAudit(ctx, "manage:customer")).ok) {
            return { error: "You don't have permission to create customers." };
          }
          try {
            const id = await createCustomer(workspaceId, input, user.id);
            // createCustomer is event-only (no audit) - audit it here so AI-created
            // customers are traceable, mirroring the invoice/quote/books services.
            await writeAudit({
              workspaceId,
              actorUserId: user.id,
              action: "customer.create",
              targetType: "customer",
              targetId: id,
              metadata: { source: "ai_assistant", name: input.name },
            });
            return { id, name: input.name };
          } catch (err) {
            // Duplicate email - the workspace already has an active customer with
            // that email (partial unique index `customers_workspace_email_unique`).
            // Recover by returning the existing customer so the model can say
            // "X already exists - I'll use them" and continue (e.g. create the
            // invoice for that customer) instead of dumping a raw Postgres error
            // into the chat. Only an email-bearing input can hit the unique index;
            // a different failure re-throws so it surfaces honestly.
            const message = err instanceof Error ? err.message : "";
            if (!/unique|duplicate/i.test(message)) throw err;
            const existing = input.email
              ? await getCustomerByEmail(workspaceId, input.email)
              : null;
            if (!existing) throw err;
            return { id: existing.id, name: existing.name, existed: true };
          }
        },
      });

      // 8b. updateCustomer - patch an existing customer (e.g. add a phone number).
      // Same gate as create. The model resolves the customer id from listCustomers
      // or a prior createCustomer result; omitted fields are left unchanged.
      tools.updateCustomer = tool({
        description:
          "Update an existing customer's fields (e.g. add or change a phone number, email, company, notes). Use after the user confirms. Pass the customer id (from listCustomers or a prior create) and only the fields to change - omitted fields are left unchanged. Returns { id, updated: true }.",
        inputSchema: z.object({
          customerId: z
            .string()
            .uuid()
            .describe("The existing customer's id (from listCustomers)."),
          name: z.string().min(1).max(200).optional().describe("New display name."),
          email: z.string().email().optional().describe("New contact email."),
          phone: z.string().max(50).optional().describe("New phone number."),
          company: z.string().max(200).optional().describe("New company name."),
          notes: z.string().max(2000).optional().describe("New free-form notes."),
        }),
        execute: async (input) => {
          // Re-check the gate inside execute (defense in depth).
          if (!(await authorizeOrAudit(ctx, "manage:customer")).ok) {
            return { error: "You don't have permission to update customers." };
          }
          const { customerId, ...patch } = input;
          const id = branded<"CustomerId">(customerId);
          try {
            await updateCustomer(workspaceId, id, patch, user.id);
            // Like createCustomer, updateCustomer is event-only - audit it here so
            // AI-made changes are traceable.
            await writeAudit({
              workspaceId,
              actorUserId: user.id,
              action: "customer.update",
              targetType: "customer",
              targetId: id,
              metadata: {
                source: "ai_assistant",
                fields: Object.keys(patch),
              },
            });
            return { id: customerId, updated: true };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            // "Customer not found." → friendly error so the model can recover (it
            // picked a stale/wrong id). Duplicate email on update → same friendly
            // message as the customer UI. Anything else re-throws honestly.
            if (/not found/i.test(message)) return { error: "Customer not found." };
            if (/unique|duplicate/i.test(message))
              return { error: "Another customer with that email already exists." };
            throw err;
          }
        },
      });
    }

    // 9. createInvoice - module-gated. Needs manage:invoice.
    if (hasModule("invoices") && can("manage:invoice")) {
      tools.createInvoice = tool({
        description:
          'Create a draft invoice in the workspace. Use after the user confirms the line items + totals. Returns the new invoice id + number. Required: issueDate (ISO), taxRate (integer percent, 10 = 10%), lineItems (≥1). To attach an existing customer, pass customerEmail (preferred - e.g. "amos@miruku.com") or customerId (from listCustomers); omit both for a walk-in invoice. Optional: dueDate (ISO), currency, notes.',
        inputSchema: z.object({
          customerEmail: z
            .string()
            .email()
            .optional()
            .describe("Customer email - preferred way to attach an existing customer."),
          customerId: z
            .string()
            .uuid()
            .optional()
            .describe("Optional customer id (from listCustomers)."),
          issueDate: z.string().datetime().describe("Issue date (ISO 8601)."),
          dueDate: z.string().datetime().optional().describe("Optional due date (ISO 8601)."),
          currency: z.string().length(3).optional().describe("ISO 4217 code, e.g. AUD."),
          taxRate: z
            .number()
            .int()
            .min(0)
            .max(100)
            .describe("Tax as integer percent (10 = 10% GST)."),
          notes: z.string().max(2000).optional().describe("Optional invoice notes."),
          lineItems: z
            .array(
              z.object({
                description: z.string().min(1).max(500),
                quantity: z.number().int().min(1),
                unitPriceCents: z.number().int().min(0),
              }),
            )
            .min(1)
            .describe("Line items (at least one)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) {
            return { error: "You don't have permission to create invoices." };
          }
          const resolved = await resolveCustomerId(workspaceId, {
            customerId: input.customerId,
            customerEmail: input.customerEmail,
          });
          if (resolved.error) return { error: resolved.error };
          try {
            const id = await createInvoice(
              workspaceId,
              {
                customerId: resolved.id,
                issueDate: new Date(input.issueDate),
                dueDate: input.dueDate ? new Date(input.dueDate) : null,
                currency: input.currency,
                taxRate: input.taxRate,
                notes: input.notes ?? null,
                lineItems: input.lineItems.map((li) => ({
                  description: li.description,
                  quantity: li.quantity,
                  unitPriceCents: li.unitPriceCents,
                })),
              },
              user.id,
            );
            return { id };
          } catch (err) {
            // The service retries the invoice-number unique race 3× then re-throws the
            // raw Postgres error. Surface a friendly, recoverable message instead of
            // dumping the raw constraint-violation text into the chat. Anything else
            // re-throws so it surfaces honestly.
            const message = err instanceof Error ? err.message : "";
            if (/unique|duplicate/i.test(message))
              return {
                error: "Couldn't generate a unique invoice number just now - please try again.",
              };
            throw err;
          }
        },
      });
    }

    // 10. createQuote - module-gated. Needs manage:quote.
    if (hasModule("quotes") && can("manage:quote")) {
      tools.createQuote = tool({
        description:
          'Create a draft quote in the workspace. Use after the user confirms the line items + totals. Returns the new quote id. Required: issueDate (ISO), taxRate (integer percent), lineItems (≥1). To attach an existing customer, pass customerEmail (preferred - e.g. "amos@miruku.com") or customerId (from listCustomers); omit both for a walk-in quote. Optional: validUntil (ISO), currency, notes.',
        inputSchema: z.object({
          customerEmail: z
            .string()
            .email()
            .optional()
            .describe("Customer email - preferred way to attach an existing customer."),
          customerId: z
            .string()
            .uuid()
            .optional()
            .describe("Optional customer id (from listCustomers)."),
          issueDate: z.string().datetime().describe("Issue date (ISO 8601)."),
          validUntil: z
            .string()
            .datetime()
            .optional()
            .describe("Optional validity expiry (ISO 8601)."),
          currency: z.string().length(3).optional().describe("ISO 4217 code, e.g. AUD."),
          taxRate: z
            .number()
            .int()
            .min(0)
            .max(100)
            .describe("Tax as integer percent (10 = 10% GST)."),
          notes: z.string().max(2000).optional().describe("Optional quote notes."),
          lineItems: z
            .array(
              z.object({
                description: z.string().min(1).max(500),
                quantity: z.number().int().min(1),
                unitPriceCents: z.number().int().min(0),
              }),
            )
            .min(1)
            .describe("Line items (at least one)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:quote")).ok) {
            return { error: "You don't have permission to create quotes." };
          }
          const resolved = await resolveCustomerId(workspaceId, {
            customerId: input.customerId,
            customerEmail: input.customerEmail,
          });
          if (resolved.error) return { error: resolved.error };
          try {
            const id = await createQuote(
              workspaceId,
              {
                customerId: resolved.id,
                issueDate: new Date(input.issueDate),
                validUntil: input.validUntil ? new Date(input.validUntil) : null,
                currency: input.currency,
                taxRate: input.taxRate,
                notes: input.notes ?? null,
                lineItems: input.lineItems.map((li) => ({
                  description: li.description,
                  quantity: li.quantity,
                  unitPriceCents: li.unitPriceCents,
                })),
              },
              user.id,
            );
            return { id };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/unique|duplicate/i.test(message))
              return {
                error: "Couldn't generate a unique quote number just now - please try again.",
              };
            throw err;
          }
        },
      });
    }

    // 11. createTransaction - module-gated (Books). Needs manage:books.
    if (hasModule("books") && can("manage:books")) {
      tools.createTransaction = tool({
        description:
          "Create a Books transaction (income or expense) in the workspace. Use after the user confirms. Returns the new transaction id. Required: type (income|expense), amountCents (positive integer), date (ISO), description, category (slug matching the type - e.g. income: sales|services|software|hardware|invoice|gig|other_income; expense: rent|utilities|supplies|travel|wages|software_expense|vehicle_expense|other_expense; note software=income, software_expense=expense). To link an existing customer, pass customerEmail (preferred) or customerId; omit both for a walk-in. Optional: notes.",
        inputSchema: z.object({
          type: z.enum(["income", "expense"]).describe("Transaction type."),
          amountCents: z.number().int().min(1).describe("Amount in integer cents (positive)."),
          date: z.string().datetime().describe("Transaction date (ISO 8601)."),
          description: z.string().min(1).max(500).describe("Short description."),
          category: z
            .string()
            .min(1)
            .max(50)
            .describe("Category slug (must match the type's catalog)."),
          customerEmail: z
            .string()
            .email()
            .optional()
            .describe("Customer email - preferred way to link an existing customer."),
          customerId: z.string().uuid().optional().describe("Optional linked customer id."),
          notes: z.string().max(2000).optional().describe("Optional notes."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:books")).ok) {
            return { error: "You don't have permission to create transactions." };
          }
          // Pre-validate the category slug against the type's catalog BEFORE calling the
          // service, so a wrong slug (the model picks freely) returns a friendly error that
          // lists the valid slugs for a retry - instead of a raw "Unknown category" throw.
          // Catches the software (income) vs software_expense (expense) trap.
          const validSlugs = categoriesForType(input.type).map((c) => c.key);
          if (!validSlugs.includes(input.category)) {
            return {
              error: `Unknown category "${input.category}" for ${input.type} transactions. Valid ${input.type} categories: ${validSlugs.join(", ")}.`,
            };
          }
          // Resolve the customer by email (preferred) or id - same recovery pattern as
          // createInvoice, so a stale uuid no longer dumps "Customer not found in this
          // workspace." into the chat.
          const resolved = await resolveCustomerId(workspaceId, {
            customerId: input.customerId,
            customerEmail: input.customerEmail,
          });
          if (resolved.error) return { error: resolved.error };
          try {
            const id = await createTransaction(
              workspaceId,
              {
                type: input.type,
                amountCents: input.amountCents,
                date: new Date(input.date),
                description: input.description,
                category: input.category,
                customerId: resolved.id,
                notes: input.notes ?? null,
              },
              user.id,
            );
            return { id };
          } catch (err) {
            // Map the remaining known throws to friendly messages; re-throw unknowns.
            const message = err instanceof Error ? err.message : "";
            if (/must be greater than 0/i.test(message))
              return { error: "Amount must be greater than 0." };
            if (/not found in this workspace/i.test(message))
              return { error: "I couldn't find that customer in this workspace." };
            throw err;
          }
        },
      });
    }

    // 12. extractReceipt - module-gated (Books). Needs manage:books. The first write
    // tool that may consume a credit: the service handles the
    // `RECEIPT_EXTRACTION_COST_CENTS` opt-in (default 0 = free). Returns the extracted
    // summary so the model can present it for human review before the user applies it
    // in the /books/receipts queue.
    if (hasModule("books") && can("manage:books")) {
      tools.extractReceipt = tool({
        description:
          "Run AI receipt extraction on an uploaded receipt file. The service downloads the file bytes, sends them to the vision model, and stores the structured result (merchant, totalCents, taxCents, currency, category, confidence, lineItems) in the receipt review queue. The user reviews and applies it from /books/receipts. Use after the user confirms. Required: fileId (uuid of an already-uploaded receipt). Returns the extraction id + the extracted summary, or an error if the file isn't found or credit is insufficient.",
        inputSchema: z.object({
          fileId: z.string().uuid().describe("The uploaded receipt file id (uuid)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:books")).ok) {
            return { error: "You don't have permission to extract receipts." };
          }
          try {
            const id = await extractReceipt(workspaceId, branded<"FileId">(input.fileId), user.id);
            return { id };
          } catch (err) {
            return {
              error: err instanceof Error ? err.message : "Failed to extract receipt.",
            };
          }
        },
      });
    }

    // ── Drive write tools (gig earnings / mileage / vehicle expenses) ──────────────
    // Gated manage:drive + drive module installed + writeEnabled. Each validates its
    // slug/enum up front (friendly error listing valid values) and wraps the service
    // call in try/catch.

    // 13. createEarning - log gig earnings (Drive). Needs manage:drive.
    if (hasModule("drive") && can("manage:drive")) {
      tools.createEarning = tool({
        description:
          "Log a Drive gig-earning for the workspace (e.g. an Uber/DoorDash shift). Use after the user confirms. Required: platform (slug: uber|uber_eats|doordash|airtasker|menulog|lyft|instacart|other), amountCents (positive integer), date (ISO), description. Optional: currency, notes. Returns the new earning id.",
        inputSchema: z.object({
          platform: z.string().min(1).max(50).describe("Platform slug (e.g. uber, doordash)."),
          amountCents: z.number().int().min(1).describe("Earnings in integer cents (positive)."),
          date: z.string().datetime().describe("Earning date (ISO 8601)."),
          description: z
            .string()
            .min(1)
            .max(500)
            .describe("Short description (e.g. 'Evening shift')."),
          currency: z.string().length(3).optional().describe("ISO 4217 code, e.g. AUD."),
          notes: z.string().max(2000).optional().describe("Optional notes."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) {
            return { error: "You don't have permission to log drive earnings." };
          }
          if (!isDrivePlatform(input.platform)) {
            return {
              error: `Unknown platform "${input.platform}". Valid platforms: ${DRIVE_PLATFORMS.map((p) => p.key).join(", ")}.`,
            };
          }
          try {
            const id = await createEarning(
              workspaceId,
              {
                platform: input.platform,
                amountCents: input.amountCents,
                date: new Date(input.date),
                description: input.description,
                currency: input.currency,
                notes: input.notes ?? null,
              },
              user.id,
            );
            return { id };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/must be greater than 0/i.test(message))
              return { error: "Amount must be greater than 0." };
            if (/unknown platform/i.test(message)) return { error: message };
            throw err;
          }
        },
      });

      // 14. createTrip - log mileage (Drive). Distance is collected in km and converted
      // to meters (the service stores INTEGER meters). Needs manage:drive.
      tools.createTrip = tool({
        description:
          "Log a Drive mileage trip for the workspace (e.g. a 45 km shift). Use after the user confirms. Required: platform (slug - see createEarning), distanceKm (positive number of kilometers - converted to meters internally), date (ISO). Optional: purpose, notes. Returns the new trip id.",
        inputSchema: z.object({
          platform: z.string().min(1).max(50).describe("Platform slug (e.g. uber, doordash)."),
          distanceKm: z.number().min(0.001).describe("Trip distance in kilometers (positive)."),
          date: z.string().datetime().describe("Trip date (ISO 8601)."),
          purpose: z.string().max(200).optional().describe("Optional trip purpose."),
          notes: z.string().max(2000).optional().describe("Optional notes."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) {
            return { error: "You don't have permission to log drive trips." };
          }
          if (!isDrivePlatform(input.platform)) {
            return {
              error: `Unknown platform "${input.platform}". Valid platforms: ${DRIVE_PLATFORMS.map((p) => p.key).join(", ")}.`,
            };
          }
          // The service stores integer meters; round the km → m conversion.
          const distanceMeters = Math.round(input.distanceKm * 1000);
          if (distanceMeters <= 0) return { error: "Distance must be greater than 0." };
          try {
            const id = await createTrip(
              workspaceId,
              {
                platform: input.platform,
                distanceMeters,
                date: new Date(input.date),
                purpose: input.purpose ?? null,
                notes: input.notes ?? null,
              },
              user.id,
            );
            return { id };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/must be greater than 0/i.test(message))
              return { error: "Distance must be greater than 0." };
            if (/unknown platform/i.test(message)) return { error: message };
            throw err;
          }
        },
      });

      // 15. createExpense - log a vehicle expense (Drive). Resolve the vehicle by name
      // (preferred - e.g. "Hilux") or id. Needs manage:drive.
      tools.createExpense = tool({
        description:
          "Log a Drive vehicle expense (fuel, maintenance, insurance, registration, other). Use after the user confirms. Required: vehicleName (preferred - exact vehicle name from listVehicles) or vehicleId, type (fuel|maintenance|insurance|registration|other), amountCents (positive integer), date (ISO), description. Optional: odometerKm, currency, notes. Returns the new expense id, or an error if the vehicle isn't found (call listVehicles first).",
        inputSchema: z.object({
          vehicleName: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe("Vehicle name (preferred - exact match against listVehicles)."),
          vehicleId: z.string().uuid().optional().describe("Optional vehicle id."),
          type: z
            .enum(["fuel", "maintenance", "insurance", "registration", "other"])
            .describe("Expense type."),
          amountCents: z.number().int().min(1).describe("Amount in integer cents (positive)."),
          date: z.string().datetime().describe("Expense date (ISO 8601)."),
          description: z.string().min(1).max(500).describe("Short description."),
          odometerKm: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Optional odometer reading in km."),
          currency: z.string().length(3).optional().describe("ISO 4217 code, e.g. AUD."),
          notes: z.string().max(2000).optional().describe("Optional notes."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) {
            return { error: "You don't have permission to log vehicle expenses." };
          }
          // Resolve the vehicle by id, else by exact name (case-insensitive, trimmed).
          let vehicleId: VehicleId | null = null;
          if (input.vehicleId) {
            vehicleId = branded<"VehicleId">(input.vehicleId);
          } else if (input.vehicleName) {
            const vehicles = await listVehicles(workspaceId);
            const target = input.vehicleName.trim().toLowerCase();
            const match = vehicles.find((v) => v.name.trim().toLowerCase() === target);
            if (!match) {
              return {
                error: `Vehicle "${input.vehicleName}" not found. Call listVehicles first to get the vehicle name/id.`,
              };
            }
            vehicleId = match.id;
          } else {
            return {
              error: "Provide a vehicleName (preferred) or vehicleId to log a vehicle expense.",
            };
          }
          try {
            const id = await createExpense(
              workspaceId,
              {
                vehicleId,
                type: input.type,
                amountCents: input.amountCents,
                date: new Date(input.date),
                description: input.description,
                odometerKm: input.odometerKm ?? null,
                currency: input.currency,
                notes: input.notes ?? null,
              },
              user.id,
            );
            return { id };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/not found in this workspace/i.test(message))
              return {
                error:
                  "Vehicle not found in this workspace. Call listVehicles first to get the vehicle name/id.",
              };
            if (/must be greater than 0/i.test(message))
              return { error: "Amount must be greater than 0." };
            throw err;
          }
        },
      });
    }

    // ── Books update/delete ─────────────────────────────────────────────────────
    // Gated manage:books + books module installed + writeEnabled.

    // 16. updateTransaction - patch an existing Books transaction. Needs manage:books.
    if (hasModule("books") && can("manage:books")) {
      tools.updateTransaction = tool({
        description:
          "Update an existing Books transaction's fields (e.g. re-categorize an expense, fix an amount, change the date). Use after the user confirms. Pass the transaction id (from listTransactions) and only the fields to change - omitted fields are left unchanged. If you change the type, you must also pass a category valid for the new type (income: sales|services|software|hardware|invoice|gig|other_income; expense: rent|utilities|supplies|travel|wages|software_expense|vehicle_expense|other_expense). To link a customer, pass customerEmail (preferred) or customerId. Returns { id, updated: true }, or an error if the transaction isn't found or the category is invalid for the type.",
        inputSchema: z.object({
          transactionId: z.string().uuid().describe("The transaction id (from listTransactions)."),
          type: z.enum(["income", "expense"]).optional().describe("New transaction type."),
          amountCents: z.number().int().min(1).optional().describe("New amount in integer cents."),
          date: z.string().datetime().optional().describe("New transaction date (ISO 8601)."),
          description: z.string().min(1).max(500).optional().describe("New description."),
          category: z.string().min(1).max(50).optional().describe("New category slug."),
          customerEmail: z
            .string()
            .email()
            .optional()
            .describe("Link a customer by email (preferred over customerId)."),
          customerId: z.string().uuid().optional().describe("New linked customer id."),
          notes: z.string().max(2000).optional().describe("New notes."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:books")).ok) {
            return { error: "You don't have permission to update transactions." };
          }
          const { transactionId, ...patch } = input;
          const txId = branded<"BookTransactionId">(transactionId);
          // Mirror the service's rule: changing type requires a category for the new type.
          if (patch.type !== undefined && patch.category === undefined) {
            return { error: "Category is required when changing transaction type." };
          }
          // Pre-validate the category against the (possibly new) type's catalog, so a
          // wrong slug returns a friendly error listing the valid slugs instead of a raw
          // "Unknown category" throw. When only the category changes, validate against the
          // new type if supplied, else defer to the service (it validates vs the existing
          // type and throws "Unknown category" - mapped below).
          if (patch.category !== undefined && patch.type !== undefined) {
            const validSlugs = categoriesForType(patch.type).map((c) => c.key);
            if (!validSlugs.includes(patch.category)) {
              return {
                error: `Unknown category "${patch.category}" for ${patch.type} transactions. Valid ${patch.type} categories: ${validSlugs.join(", ")}.`,
              };
            }
          }
          // Resolve the customer by email (preferred) or id.
          let customerId: CustomerId | null | undefined = undefined;
          if (patch.customerEmail !== undefined || patch.customerId !== undefined) {
            const resolved = await resolveCustomerId(workspaceId, {
              customerId: patch.customerId,
              customerEmail: patch.customerEmail,
            });
            if (resolved.error) return { error: resolved.error };
            customerId = resolved.id;
          }
          try {
            await updateTransaction(
              workspaceId,
              txId,
              {
                type: patch.type,
                amountCents: patch.amountCents,
                date: patch.date ? new Date(patch.date) : undefined,
                description: patch.description,
                category: patch.category,
                customerId,
                notes: patch.notes,
              },
              user.id,
            );
            return { id: transactionId, updated: true };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/not found/i.test(message)) return { error: "Transaction not found." };
            if (/unknown category/i.test(message)) return { error: message };
            if (/must be greater than 0/i.test(message))
              return { error: "Amount must be greater than 0." };
            if (/not found in this workspace/i.test(message))
              return { error: "I couldn't find that customer in this workspace." };
            throw err;
          }
        },
      });

      // 17. deleteTransaction - hard-delete a Books transaction. Destructive: the system
      // prompt's confirm-before-write rule covers it. Needs manage:books.
      tools.deleteTransaction = tool({
        description:
          "Permanently delete a Books transaction. Destructive - confirm the exact transaction with the user first (state the description + amount). Required: transactionId (from listTransactions). Returns { id, deleted: true }, or an error if the transaction isn't found.",
        inputSchema: z.object({
          transactionId: z.string().uuid().describe("The transaction id (from listTransactions)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:books")).ok) {
            return { error: "You don't have permission to delete transactions." };
          }
          const txId = branded<"BookTransactionId">(input.transactionId);
          try {
            const deleted = await deleteTransaction(workspaceId, txId, user.id);
            if (!deleted) return { error: "Transaction not found." };
            return { id: input.transactionId, deleted: true };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/not found/i.test(message)) return { error: "Transaction not found." };
            throw err;
          }
        },
      });
    }

    // ── Invoice/quote action tools (resolve by number - human-meaningful) ──────────
    // The model carries a short, stable document number the user actually said
    // ("send INV-2026-0007"), never a uuid. Each action resolves the number to the
    // row first, then calls the service.

    // 18. sendInvoice - outward-facing (emails the customer a payment link). Needs
    // manage:invoice + invoices module installed.
    if (hasModule("invoices") && can("manage:invoice")) {
      tools.sendInvoice = tool({
        description:
          "Send a draft invoice to its customer - this emails them a payment link (outward-facing, so confirm the exact invoice number with the user first). Required: invoiceNumber (e.g. INV-2026-0007). Returns { sent: true, number }, or an error if the invoice isn't a draft (it may already be sent) or isn't found.",
        inputSchema: z.object({
          invoiceNumber: z
            .string()
            .min(1)
            .max(50)
            .describe("The invoice number (e.g. INV-2026-0007)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) {
            return { error: "You don't have permission to send invoices." };
          }
          const resolved = await resolveInvoiceByNumber(workspaceId, input.invoiceNumber);
          if (!resolved) return { error: `Invoice ${input.invoiceNumber} not found.` };
          const sent = await sendInvoice(workspaceId, resolved.id, user.id);
          if (!sent)
            return {
              error: `Invoice ${input.invoiceNumber} isn't a draft - it may already be sent, paid, or void.`,
            };
          return { sent: true, number: resolved.number };
        },
      });

      // 19. voidInvoice - void a draft or sent invoice. Needs manage:invoice.
      tools.voidInvoice = tool({
        description:
          "Void an invoice (draft or sent → void). Required: invoiceNumber. Returns { voided: true, number }, or an error if the invoice is already paid/void or isn't found.",
        inputSchema: z.object({
          invoiceNumber: z
            .string()
            .min(1)
            .max(50)
            .describe("The invoice number (e.g. INV-2026-0007)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) {
            return { error: "You don't have permission to void invoices." };
          }
          const resolved = await resolveInvoiceByNumber(workspaceId, input.invoiceNumber);
          if (!resolved) return { error: `Invoice ${input.invoiceNumber} not found.` };
          const voided = await voidInvoice(workspaceId, resolved.id, user.id);
          if (!voided)
            return {
              error: `Invoice ${input.invoiceNumber} can't be voided - it may be paid or already void.`,
            };
          return { voided: true, number: resolved.number };
        },
      });

      // 20. markInvoicePaid - mark a sent invoice paid (manual / offline payment). Needs
      // manage:invoice.
      tools.markInvoicePaid = tool({
        description:
          "Mark a sent invoice as paid (manual / offline payment - e.g. cash, bank transfer). Required: invoiceNumber. Returns { paid: true, number }, or an error if the invoice isn't sent yet (or is already paid/void) or isn't found.",
        inputSchema: z.object({
          invoiceNumber: z
            .string()
            .min(1)
            .max(50)
            .describe("The invoice number (e.g. INV-2026-0007)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) {
            return { error: "You don't have permission to mark invoices paid." };
          }
          const resolved = await resolveInvoiceByNumber(workspaceId, input.invoiceNumber);
          if (!resolved) return { error: `Invoice ${input.invoiceNumber} not found.` };
          const paid = await markInvoicePaid(workspaceId, resolved.id, user.id);
          if (!paid)
            return {
              error: `Invoice ${input.invoiceNumber} isn't sent yet - send it before marking it paid.`,
            };
          return { paid: true, number: resolved.number };
        },
      });
    }

    // 21. convertQuoteToInvoice - composite: get an accepted quote → create a draft
    // invoice from its line items → mark the quote converted. Needs manage:quote +
    // manage:invoice + both modules installed.
    if (
      hasModule("quotes") &&
      hasModule("invoices") &&
      can("manage:quote") &&
      can("manage:invoice")
    ) {
      tools.convertQuoteToInvoice = tool({
        description:
          "Convert an accepted quote into a draft invoice (copies the customer, line items, tax rate, and currency). Required: quoteNumber (e.g. QUO-2026-0003). The quote must be in the accepted state (the customer accepted it). Returns { invoiceId, invoiceNumber }, or an error if the quote isn't found or isn't accepted yet.",
        inputSchema: z.object({
          quoteNumber: z.string().min(1).max(50).describe("The quote number (e.g. QUO-2026-0003)."),
        }),
        execute: async (input) => {
          if (!(await authorizeOrAudit(ctx, "manage:quote")).ok) {
            return { error: "You don't have permission to convert quotes." };
          }
          if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) {
            return { error: "You don't have permission to create invoices." };
          }
          const resolved = await resolveQuoteByNumber(workspaceId, input.quoteNumber);
          if (!resolved) return { error: `Quote ${input.quoteNumber} not found.` };
          const quote = await getQuote(workspaceId, resolved.id);
          if (!quote) return { error: `Quote ${input.quoteNumber} not found.` };
          if (quote.status !== "accepted") {
            return {
              error: `Quote ${input.quoteNumber} isn't accepted yet - the customer must accept it before it can be converted.`,
            };
          }
          try {
            const invoiceId = await createInvoice(
              workspaceId,
              {
                customerId: quote.customerId,
                issueDate: new Date(),
                currency: quote.currency,
                taxRate: quote.taxRate,
                notes: quote.notes ?? null,
                lineItems: quote.lineItems.map((li) => ({
                  description: li.description,
                  quantity: li.quantity,
                  unitPriceCents: li.unitPriceCents,
                })),
              },
              user.id,
            );
            // createInvoice returns the new id; fetch the generated number for the
            // quote-conversion audit trail (markQuoteConverted records it).
            const invoice = await getInvoice(workspaceId, invoiceId);
            const invoiceNumber = invoice?.number ?? "";
            const converted = await markQuoteConverted(
              workspaceId,
              resolved.id,
              invoiceId,
              invoiceNumber,
              user.id,
            );
            if (!converted) {
              // The invoice was created but the quote transition failed (e.g. it was
              // converted by someone else in the race window). Surface honestly.
              return {
                error: `Quote ${input.quoteNumber} couldn't be marked converted (it may have been converted already). Invoice ${invoiceNumber || invoiceId} was created - review it in Invoices.`,
              };
            }
            return { invoiceId, invoiceNumber };
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/unique|duplicate/i.test(message))
              return {
                error: "Couldn't generate a unique invoice number just now - please try again.",
              };
            throw err;
          }
        },
      });
    }
  }

  return tools as ToolSet;
}

/**
 * Build the canned mock reply from real workspace data (no model, no API key).
 * The route calls this for `AI_PROVIDER=mock` and streams the returned text via
 * `streamMockAssistant`. Mirrors what a real model would say after calling
 * `getWorkspaceOverview`. The overview's gates are honoured inside
 * `computeWorkspaceOverview` (null KPIs for uninstalled/unauthorized modules).
 */
export async function buildMockAssistantReply(
  ctx: WorkspaceContext,
  installedModules: readonly ModuleKey[],
): Promise<string> {
  const data = await computeWorkspaceOverview(ctx, installedModules);

  const fmt = (cents: number | null) =>
    cents === null
      ? "n/a"
      : new Intl.NumberFormat("en-AU", { style: "currency", currency: data.currency }).format(
          cents / 100,
        );

  const lines: string[] = [
    "Here's a snapshot of your workspace (current month):",
    `- Installed modules: ${data.installedModules.length ? data.installedModules.join(", ") : "none yet"}`,
    `- Net cash flow: ${fmt(data.kpis.cashCents)}`,
    `- Outstanding invoices: ${fmt(data.kpis.outstandingCents)}${data.kpis.overdueInvoiceCount ? ` (${data.kpis.overdueInvoiceCount} overdue)` : ""}`,
    `- Total income this month: ${fmt(data.kpis.incomeCents)}`,
    `- Ready to invoice (accepted quotes): ${fmt(data.kpis.pendingQuotesCents)}`,
  ];
  if (data.recentActivity && data.recentActivity.length > 0) {
    lines.push("Recent activity:");
    for (const a of data.recentActivity.slice(0, 5)) {
      lines.push(`  - ${a.type}${a.entityType ? ` (${a.entityType})` : ""}`);
    }
  }
  lines.push(
    "\nAsk me to list invoices, quotes, transactions, customers, or recent activity for more detail.",
  );
  return lines.join("\n");
}
