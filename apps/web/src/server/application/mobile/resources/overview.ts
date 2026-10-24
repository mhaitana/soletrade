import "server-only";
import { consolidateBusinessIncome, type MobileHomeOverview } from "@soletrade/contracts";
import { countExtractions } from "@/server/domains/books/receipt-extraction";
import { can } from "@/lib/domain/permissions/index";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { listActivity } from "@/server/foundation/activity/index";
import { unreadCount } from "@/server/foundation/notifications/store";
import { listCustomers } from "@/server/foundation/customers/index";
import type { CustomerRow } from "@/lib/domain/customers/types";
import * as invoices from "@/server/domains/invoices/index";
import * as quotes from "@/server/domains/quotes/index";
import * as books from "@/server/domains/books/index";
import * as drive from "@/server/domains/drive/index";
import { readFiles } from "@/server/application/mobile/resources/files";
import { formatCents } from "@/lib/domain/billing/pricing";
import { PERIODS, periodRange, previousPeriodRange } from "@/utils/periods";
import {
  found,
  offset,
  page,
  parse,
  type Context,
  type Query,
} from "@/server/application/mobile/resources/common";
import { z } from "zod";
export async function dashboard(ctx: Context, q: Query) {
  const workspace = found(await getWorkspace(ctx.workspaceId));
  const modules = await getInstalledModules(ctx.workspaceId);
  const range = periodRange(q.period ?? "month", undefined, workspace.fyStartMonth);
  const previous = previousPeriodRange(q.period ?? "month", undefined, workspace.fyStartMonth);
  const [invoice, quote, book, driving, activity, count, pendingReceipts] = await Promise.all([
    modules.includes("invoices") && can(ctx.role, "view:invoice")
      ? invoices.getInvoiceDashboardSummary(ctx.workspaceId, range, previous)
      : null,
    modules.includes("quotes") && can(ctx.role, "view:quote")
      ? quotes.getQuoteDashboardSummary(ctx.workspaceId, range)
      : null,
    modules.includes("books") && can(ctx.role, "view:books")
      ? books.getBookSummary(ctx.workspaceId, {
          dateFrom: range.start ?? undefined,
          dateTo: range.end,
        })
      : null,
    modules.includes("drive") && can(ctx.role, "view:drive")
      ? drive.getDriveSummary(ctx.workspaceId, {
          dateFrom: range.start ?? undefined,
          dateTo: range.end,
        })
      : null,
    can(ctx.role, "view:activity") ? listActivity(ctx.workspaceId, { limit: 10 }) : null,
    unreadCount(ctx.workspaceId, ctx.user.id),
    modules.includes("books") && can(ctx.role, "manage:books")
      ? countExtractions(ctx.workspaceId, { status: "pending" })
      : 0,
  ]);
  const totalIncome = consolidateBusinessIncome({
    books: book ? { currentCents: book.incomeCents, previousCents: null } : null,
    invoices: invoice
      ? { currentCents: invoice.paidCents, previousCents: invoice.previousPaidCents }
      : null,
    drive: driving ? { currentCents: driving.totalEarningsCents, previousCents: null } : null,
  });
  const overview: MobileHomeOverview = {
    workspaceId: ctx.workspaceId,
    period: q.period ?? "month",
    periodLabel: PERIODS.find((item) => item.key === (q.period ?? "month"))?.label ?? "This month",
    currency: workspace.defaultCurrency,
    totalIncome,
    kpis: [],
    attention: [],
  };
  if (totalIncome.source)
    overview.kpis.push({ id: "income", label: "Total income", cents: totalIncome.currentCents });
  if (book || driving) {
    const expenses = book ? book.expenseCents : driving!.totalExpensesCents;
    overview.kpis.push({ id: "expenses", label: "Expenses", cents: expenses });
    overview.kpis.push({
      id: "net-income",
      label: "Net income",
      cents: totalIncome.currentCents - expenses,
    });
  }
  if (invoice)
    overview.kpis.push({
      id: "outstanding",
      label: "Outstanding invoices",
      cents: invoice.outstandingCents,
    });
  if (invoice?.overdueCount)
    overview.attention.push({
      id: "overdue-invoices",
      title: "Overdue invoices",
      count: invoice.overdueCount,
      resource: "invoices",
      status: "overdue",
    });
  if (quote?.readyCount)
    overview.attention.push({
      id: "accepted-quotes",
      title: "Accepted quotes ready to invoice",
      count: quote.readyCount,
      resource: "quotes",
      status: "accepted",
    });
  if (pendingReceipts)
    overview.attention.push({
      id: "pending-receipts",
      title: "Receipts to review",
      count: pendingReceipts,
      resource: "books/receipts",
      status: "pending",
    });
  if (invoice?.draftCount)
    overview.attention.push({
      id: "draft-invoices",
      title: "Draft invoices",
      count: invoice.draftCount,
      resource: "invoices",
      status: "draft",
    });
  return {
    workspace,
    overview,
    modules,
    invoices: invoice,
    quotes: quote,
    books: book,
    drive: driving,
    activity: activity?.items ?? [],
    unreadCount: count,
  };
}
export async function customerTimeline(ctx: Context, customer: CustomerRow, q: Query) {
  const modules = await getInstalledModules(ctx.workspaceId);
  const target = q.limit + offset(q) + 1;
  async function collect<T>(
    list: (opts: { customerId: typeof customer.id; limit: number; offset: number }) => Promise<T[]>,
  ): Promise<T[]> {
    const rows: T[] = [];
    while (rows.length < target) {
      const batch = await list({
        customerId: customer.id,
        limit: Math.min(100, target - rows.length),
        offset: rows.length,
      });
      rows.push(...batch);
      if (batch.length < Math.min(100, target - rows.length + batch.length)) break;
    }
    return rows;
  }
  const [invoice, quote, transaction, activity] = await Promise.all([
    modules.includes("invoices") && can(ctx.role, "view:invoice")
      ? collect((opts) => invoices.listInvoices(ctx.workspaceId, opts))
      : [],
    modules.includes("quotes") && can(ctx.role, "view:quote")
      ? collect((opts) => quotes.listQuotes(ctx.workspaceId, opts))
      : [],
    modules.includes("books") && can(ctx.role, "view:books")
      ? collect((opts) => books.listTransactions(ctx.workspaceId, opts))
      : [],
    can(ctx.role, "view:activity")
      ? listActivity(ctx.workspaceId, { entityType: "customer", entityId: customer.id, limit: 100 })
      : null,
  ]);
  const rows = [
    ...invoice.map((r) => ({
      kind: "invoice",
      id: r.id,
      date: r.issueDate,
      label: r.number,
      sublabel: `${formatCents(r.totalCents, r.currency)} · ${r.status}`,
      href: `/invoices/${r.id}`,
      tone:
        r.status === "paid"
          ? "positive"
          : r.status === "void"
            ? "negative"
            : r.status === "overdue"
              ? "warning"
              : "neutral",
    })),
    ...quote.map((r) => ({
      kind: "quote",
      id: r.id,
      date: r.issueDate,
      label: r.number,
      sublabel: `${formatCents(r.totalCents, r.currency)} · ${r.status}`,
      href: `/quotes/${r.id}`,
      tone:
        r.status === "accepted" || r.status === "converted"
          ? "positive"
          : r.status === "declined" || r.status === "expired"
            ? "negative"
            : "neutral",
    })),
    ...transaction.map((r) => ({
      kind: "transaction",
      id: r.id,
      date: r.date,
      label: r.description,
      sublabel: `${r.type === "income" ? "+" : "−"}${formatCents(r.amountCents, r.currency)}`,
      href: "/books",
      tone: r.type === "income" ? "positive" : "negative",
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id));
  return { customer, ...page(rows.slice(offset(q)), q), activity: activity?.items ?? [] };
}
export async function search(ctx: Context, q: Query) {
  const term = parse(z.string().trim().min(2).max(100), q.q ?? q.search);
  const limit = Math.min(q.limit, 20);
  const modules = await getInstalledModules(ctx.workspaceId);
  const opts = { search: term, limit };
  const groups: { module: string; results: { id: string; label: string; href: string }[] }[] = [];
  if (can(ctx.role, "view:customer"))
    groups.push({
      module: "customers",
      results: (await listCustomers(ctx.workspaceId, opts)).map((r) => ({
        id: r.id,
        label: r.name,
        href: `/customers/${r.id}`,
      })),
    });
  if (modules.includes("invoices") && can(ctx.role, "view:invoice"))
    groups.push({
      module: "invoices",
      results: (await invoices.listInvoices(ctx.workspaceId, opts)).map((r) => ({
        id: r.id,
        label: r.number,
        href: `/invoices/${r.id}`,
      })),
    });
  if (modules.includes("quotes") && can(ctx.role, "view:quote"))
    groups.push({
      module: "quotes",
      results: (await quotes.listQuotes(ctx.workspaceId, opts)).map((r) => ({
        id: r.id,
        label: r.number,
        href: `/quotes/${r.id}`,
      })),
    });
  if (modules.includes("books") && can(ctx.role, "view:books"))
    groups.push({
      module: "books",
      results: (await books.listTransactions(ctx.workspaceId, opts)).map((r) => ({
        id: r.id,
        label: r.description,
        href: `/books/${r.id}`,
      })),
    });
  if (modules.includes("drive") && can(ctx.role, "view:drive")) {
    const [e, t, x] = await Promise.all([
      drive.listEarnings(ctx.workspaceId, opts),
      drive.listTrips(ctx.workspaceId, opts),
      drive.listExpenses(ctx.workspaceId, opts),
    ]);
    groups.push({
      module: "drive",
      results: [
        ...e.map((r) => ({ id: r.id, label: r.description, href: "/drive" })),
        ...t.map((r) => ({ id: r.id, label: r.purpose ?? "Trip", href: "/drive" })),
        ...x.map((r) => ({ id: r.id, label: r.description, href: "/drive" })),
      ].slice(0, limit),
    });
  }
  if (can(ctx.role, "view:file")) {
    const result = await readFiles(ctx, [], { ...q, search: term, limit, cursor: undefined });
    if ("items" in result)
      groups.push({
        module: "files",
        results: result.items.map((r) => ({ id: r.id, label: r.fileName, href: "/files" })),
      });
  }
  return { groups: groups.filter((g) => g.results.length) };
}
