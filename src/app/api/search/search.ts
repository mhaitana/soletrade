import "server-only";
import { getInstalledModules } from "@/platform/module-installations";
import { listCustomers, type CustomerRow } from "@/platform/customers";
import { listFiles, type FileRecord } from "@/platform/files";
import { listInvoices, type InvoiceRow } from "@/modules/invoices";
import { listQuotes, type QuoteRow } from "@/modules/quotes";
import { listTransactions, type TransactionRow } from "@/modules/books";
import {
  listEarnings,
  listTrips,
  listExpenses,
  type EarningRow,
  type TripRow,
  type ExpenseRow,
} from "@/modules/drive";
import { formatCents } from "@/platform/billing/pricing";
import { formatBytes } from "@/shared/lib/format";
import { formatDate } from "@/shared/utils/format-date";
import type { WorkspaceId } from "@/shared/types/ids";
import type { ModuleKey } from "@/shared/constants/modules";
import {
  SEARCH_GROUP_ORDER,
  type SearchModule,
  type SearchResult,
  type SearchResultGroup,
} from "@/shared/types/search";

/**
 * Global search composition root (Wave 3). Lives in the app layer (not `src/platform/*`)
 * because it wires the customer/files platform services to the four module services —
 * `platform/*` MUST NOT import `modules/*` (the bulletproof-react boundary), and a
 * composition root that fans out across modules is exactly the app-layer concern the
 * dashboard loader (`src/app/(app)/dashboard/actions.ts`) already embodies.
 *
 * Fans out across customers + every installed module's list function (each already supports
 * `{ search }`), tags each row with a label/sublabel/href, and groups results by module.
 * Search is read-only + module-gated (not role-gated): a viewer sees the same results a
 * manager does — no `authorizeOrAudit` calls here. Each list function is already
 * workspace-scoped + IDOR-safe, so cross-workspace leakage is impossible at the source.
 *
 * The leading-wildcard ILIKE each list function runs is index-backed by `pg_trgm` gin indexes
 * (migration 0017) — without them every search is a seq scan. The `< 2` char guard avoids
 * 1-char seq scans (a single character matches most rows and isn't useful).
 */

// Re-export the shared result types so the route handler + tests can import them from one place.
export type { SearchModule, SearchResult, SearchResultGroup } from "@/shared/types/search";

function customerResult(c: CustomerRow): SearchResult {
  const sub = [c.email, c.company].filter(Boolean).join(" · ");
  return {
    module: "customers",
    id: c.id,
    label: c.name,
    sublabel: sub || undefined,
    href: `/customers/${c.id}`,
  };
}

function invoiceResult(i: InvoiceRow): SearchResult {
  const sub = [i.customerName, `${formatCents(i.totalCents, i.currency)} · ${i.status}`]
    .filter(Boolean)
    .join(" · ");
  return {
    module: "invoices",
    id: i.id,
    label: i.number,
    sublabel: sub || undefined,
    href: `/invoices/${i.id}`,
  };
}

function quoteResult(q: QuoteRow): SearchResult {
  const sub = [q.customerName, `${formatCents(q.totalCents, q.currency)} · ${q.status}`]
    .filter(Boolean)
    .join(" · ");
  return {
    module: "quotes",
    id: q.id,
    label: q.number,
    sublabel: sub || undefined,
    href: `/quotes/${q.id}`,
  };
}

function transactionResult(t: TransactionRow): SearchResult {
  const sign = t.type === "income" ? "+" : "−";
  return {
    module: "books",
    id: t.id,
    label: t.description,
    sublabel: `${sign}${formatCents(t.amountCents, t.currency)}`,
    // Books has no per-transaction detail route (Wave 3) — deep-link to the list for now.
    href: `/books`,
  };
}

function earningResult(e: EarningRow): SearchResult {
  return {
    module: "drive",
    id: e.id,
    label: e.description || e.platform,
    sublabel: `${formatCents(e.amountCents, e.currency)} · ${formatDate(e.date)}`,
    href: `/drive`,
  };
}

function tripResult(t: TripRow): SearchResult {
  const km = (t.distanceMeters / 1000).toFixed(1) + " km";
  return {
    module: "drive",
    id: t.id,
    label: t.purpose || "Trip",
    sublabel: `${km} · ${formatDate(t.date)}`,
    href: `/drive`,
  };
}

function expenseResult(e: ExpenseRow): SearchResult {
  return {
    module: "drive",
    id: e.id,
    label: e.description,
    sublabel: `${e.type} · ${formatCents(e.amountCents, e.currency)}`,
    href: `/drive`,
  };
}

function fileResult(f: FileRecord): SearchResult {
  return {
    module: "files",
    id: f.id,
    label: f.fileName,
    sublabel: `${f.mimeType} · ${formatBytes(f.sizeBytes)}`,
    href: `/files`,
  };
}

/**
 * Search the workspace across customers + every installed module. Returns groups in
 * canonical order, dropping empty ones. `query` < 2 chars (after trim) returns `[]` —
 * the server-side guard matches the client's min-2-char fetch trigger.
 *
 * The caller resolves `workspaceId` from the session (`tryWorkspaceContext`/`requireWorkspaceContext`)
 * — it is never client-provided.
 */
export async function searchWorkspace(
  workspaceId: WorkspaceId,
  query: string,
  opts?: { limitPerModule?: number },
): Promise<SearchResultGroup[]> {
  const term = query?.trim();
  if (!term || term.length < 2) return [];

  const limit = Math.min(Math.max(opts?.limitPerModule ?? 6, 1), 20);
  const installed = await getInstalledModules(workspaceId);
  const has = (k: ModuleKey) => installed.includes(k);

  const [customers, invoices, quotes, transactions, drive, files] = await Promise.all([
    listCustomers(workspaceId, { search: term, limit }),
    has("invoices") ? listInvoices(workspaceId, { search: term, limit }) : Promise.resolve([]),
    has("quotes") ? listQuotes(workspaceId, { search: term, limit }) : Promise.resolve([]),
    has("books") ? listTransactions(workspaceId, { search: term, limit }) : Promise.resolve([]),
    has("drive")
      ? Promise.all([
          listEarnings(workspaceId, { search: term, limit }),
          listTrips(workspaceId, { search: term, limit }),
          listExpenses(workspaceId, { search: term, limit }),
        ])
      : Promise.resolve<[EarningRow[], TripRow[], ExpenseRow[]] | null>(null),
    // `listFiles` runs unconditionally (files is a platform surface, not a gated module).
    listFiles(workspaceId, { search: term, limit }),
  ]);

  const driveEarnings = drive?.[0] ?? [];
  const driveTrips = drive?.[1] ?? [];
  const driveExpenses = drive?.[2] ?? [];

  const groups: Record<SearchModule, SearchResult[]> = {
    customers: customers.map(customerResult),
    invoices: invoices.map(invoiceResult),
    quotes: quotes.map(quoteResult),
    books: transactions.map(transactionResult),
    drive: [
      ...driveEarnings.map(earningResult),
      ...driveTrips.map(tripResult),
      ...driveExpenses.map(expenseResult),
    ],
    files: files.items.map(fileResult),
  };

  return SEARCH_GROUP_ORDER.map((module) => ({ module, results: groups[module] })).filter(
    (g) => g.results.length > 0,
  );
}
