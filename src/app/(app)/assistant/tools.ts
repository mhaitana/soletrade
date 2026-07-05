import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { authorize, type Permission } from "@/platform/permissions";
import type { WorkspaceContext } from "@/platform/context";
import { listCustomers } from "@/platform/customers";
import { listActivity } from "@/platform/activity";
import { listInvoices, summarizeInvoices } from "@/modules/invoices";
import { listQuotes, summarizeQuotes } from "@/modules/quotes";
import { listTransactions, summarizeTransactions } from "@/modules/books";
import { listEarnings } from "@/modules/drive";
import type { ModuleKey } from "@/shared/constants/modules";
import { periodRange } from "@/shared/utils/periods";

/**
 * Workspace-aware read-only tools for the AI assistant (Phase 10). This is the
 * **composition layer** — it lives in the app layer (not `src/platform/ai`)
 * precisely because it imports module services, which the platform layer is
 * forbidden from doing. The route handler resolves the workspace context,
 * fetches the installed-module list, builds these tools (closured over the
 * context), and hands them to `streamAssistant`.
 *
 * Fail-closed: a tool the user can't use (no `view:R` grant, or its module
 * isn't installed) is **not offered** to the model. Each `execute` re-checks
 * the gate too — defence in depth — and returns a trimmed, JSON-serializable
 * shape (money as integer cents + currency; the model formats for display).
 */

const CURRENCY = "AUD";

/** Trim a Date to an ISO string for JSON-serializable tool output. */
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Cap + clamp a `limit` argument the model may pass. */
const clampLimit = (n: number | undefined, def: number, max: number): number =>
  Math.min(Math.max(typeof n === "number" ? Math.trunc(n) : def, 1), max);

export interface WorkspaceOverview {
  installedModules: readonly ModuleKey[];
  currency: string;
  kpis: {
    cashCents: number | null;
    outstandingCents: number | null;
    overdueInvoiceCount: number | null;
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

  const [booksRows, invoiceRows, quoteRows, activityPage] = await Promise.all([
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
    hasModule("quotes") && can("view:quote")
      ? listQuotes(workspaceId, { limit: 200 })
      : Promise.resolve(null),
    can("view:activity") ? listActivity(workspaceId, { limit: 5 }) : Promise.resolve(null),
  ]);

  const booksSummary = booksRows ? summarizeTransactions(booksRows) : null;
  const invoiceSummary = invoiceRows ? summarizeInvoices(invoiceRows, range) : null;
  const quoteSummary = quoteRows ? summarizeQuotes(quoteRows, range) : null;

  return {
    installedModules,
    currency: CURRENCY,
    kpis: {
      cashCents: booksSummary?.netCents ?? null,
      outstandingCents: invoiceSummary?.outstandingCents ?? null,
      overdueInvoiceCount: invoiceSummary?.overdueCount ?? null,
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
 * Only permitted, installed tools are included — the record may be empty for
 * a fresh workspace with no modules (the model then answers from the system
 * prompt alone, or via `getWorkspaceOverview` which is always offered).
 */
export function buildAssistantTools(
  ctx: WorkspaceContext,
  installedModules: readonly ModuleKey[],
): ToolSet {
  const { workspaceId, role } = ctx;
  const can = (perm: Permission) => authorize(role, perm).ok;
  const hasModule = (key: ModuleKey) => installedModules.includes(key);

  const tools: ToolSet = {};

  // 1. Workspace overview — always offered; returns nulls for uninstalled modules.
  tools.getWorkspaceOverview = tool({
    description:
      "Get a high-level overview of the workspace: installed modules, current-month cash position (Books net), outstanding invoices, revenue this month, pending quotes value, and the 5 most recent activity events. Call this first when the user asks a broad question like 'how's my business doing'.",
    inputSchema: z.object({}),
    execute: async () => computeWorkspaceOverview(ctx, installedModules),
  });

  // 2. listInvoices — module-gated.
  if (hasModule("invoices") && can("view:invoice")) {
    tools.listInvoices = tool({
      description:
        "List invoices for the workspace, newest first. Optional filters: status (draft|sent|viewed|paid|void|overdue) and a limit (default 20, max 200). Returns number, status, totalCents, currency, issueDate, paidAt, customerName.",
      inputSchema: z.object({
        status: z
          .enum(["draft", "sent", "viewed", "paid", "void", "overdue"])
          .optional()
          .describe("Filter by invoice status."),
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

  // 3. listQuotes — module-gated.
  if (hasModule("quotes") && can("view:quote")) {
    tools.listQuotes = tool({
      description:
        "List quotes for the workspace, newest first. Optional filters: status (draft|sent|viewed|accepted|declined|expired|converted) and a limit (default 20, max 200). Returns number, status, totalCents, currency, issueDate, customerName.",
      inputSchema: z.object({
        status: z
          .enum(["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"])
          .optional()
          .describe("Filter by quote status."),
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

  // 4. listTransactions — module-gated (Books).
  if (hasModule("books") && can("view:books")) {
    tools.listTransactions = tool({
      description:
        "List Books transactions (income/expense) for the workspace, newest first. Optional filters: type (income|expense), dateFrom (ISO), dateTo (ISO), and a limit (default 20, max 2000). Returns type, amountCents, currency, date, description, category, customerName.",
      inputSchema: z.object({
        type: z.enum(["income", "expense"]).optional().describe("Filter by transaction type."),
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
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          limit: clampLimit(input.limit, 20, 2000),
        });
        return rows.map((r) => ({
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

  // 5. listDriveEarnings — module-gated (Drive).
  if (hasModule("drive") && can("view:drive")) {
    tools.listDriveEarnings = tool({
      description:
        "List Drive gig earnings for the workspace, newest first. Optional filters: dateFrom (ISO), dateTo (ISO), and a limit (default 20, max 2000). Returns platform, amountCents, currency, date, description.",
      inputSchema: z.object({
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

  // 6. listCustomers — platform service, not module-gated.
  if (can("view:customer")) {
    tools.listCustomers = tool({
      description:
        "List customers for the workspace, newest first. Optional search (matches name/email/company) and a limit (default 20, max 200). Returns name, email, company, phone.",
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
          name: r.name,
          email: r.email,
          company: r.company,
          phone: r.phone,
        }));
      },
    });
  }

  // 7. listRecentActivity — platform service, not module-gated.
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
    `- Cash position: ${fmt(data.kpis.cashCents)}`,
    `- Outstanding invoices: ${fmt(data.kpis.outstandingCents)}${data.kpis.overdueInvoiceCount ? ` (${data.kpis.overdueInvoiceCount} overdue)` : ""}`,
    `- Revenue this month: ${fmt(data.kpis.revenueCents)}`,
    `- Pending quotes (accepted, not converted): ${fmt(data.kpis.pendingQuotesCents)}`,
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
