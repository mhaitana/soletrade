import "server-only";
import { NextResponse } from "next/server";
import { tryWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { isModuleEnabled } from "@/server/foundation/module-installations/index";
import { getBookSummary } from "@/server/domains/books/index";
import { parsePeriod, periodRange, type Period } from "@/utils/periods";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { renderPdf, pdfResponse } from "@/server/infrastructure/pdf/index";
import { BooksPlDocument } from "@/server/domains/books/documents/books-pl-document";

/**
 * Books P&L report PDF (Wave 4). Streams a printable P&L for `?period=` (reusing the books page's
 * period selector, so the "Download report" button is a simple link). Totals come from the same
 * Postgres summary function as the on-page figures, so the PDF always matches the page and is
 * exact for any number of transactions. Auth: resolved
 * workspace context (401) + `view:books` (403) + books module installed (404).
 */

function fmtRange(start: Date | null, end: Date): string {
  const f = (d: Date) =>
    d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return start ? `${f(start)} – ${f(end)}` : `Until ${f(end)}`;
}

export async function GET(request: Request): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "view:books")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) {
    return NextResponse.json({ error: "Books module not installed." }, { status: 404 });
  }

  const url = new URL(request.url);
  const period: Period = parsePeriod(url.searchParams.get("period") ?? undefined);
  // Fetch the workspace so the "year"/"quarter" window reanchors to its financial year
  // (matches the on-page summary) + the PDF header can show the workspace name.
  const workspace = await getWorkspace(ctx.workspaceId).catch(() => null);
  const fyStartMonth = workspace?.fyStartMonth ?? 7;
  const range = periodRange(period, undefined, fyStartMonth);

  const summary = await getBookSummary(ctx.workspaceId, {
    dateFrom: range.start ?? undefined,
    dateTo: range.end,
  });

  // Build the element before the try/catch - see invoices pdf route for rationale.
  const element = (
    <BooksPlDocument
      summary={summary}
      workspace={workspace}
      periodLabel={fmtRange(range.start, range.end)}
    />
  );
  try {
    const buffer = await renderPdf(element);
    const today = new Date().toISOString().slice(0, 10);
    return pdfResponse(buffer, `books-pl-report-${today}.pdf`);
  } catch (err) {
    console.error("[books/report] render failed:", err);
    return NextResponse.json({ error: "Failed to render PDF." }, { status: 502 });
  }
}
