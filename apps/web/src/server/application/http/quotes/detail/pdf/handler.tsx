import "server-only";
import { NextResponse } from "next/server";
import { tryWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { getQuote } from "@/server/domains/quotes/index";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { branded } from "@/types/ids";
import { renderPdf, pdfResponse } from "@/server/infrastructure/pdf/index";
import { QuoteDocument } from "@/server/domains/quotes/documents/quote-document";

/**
 * Quote PDF download (Wave 4). Workspace-member-only. IDOR-safe via `getQuote`
 * (workspaceId-scoped). Auth: resolved workspace context (401) + `view:quote` (403).
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "view:quote")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await params;
  const quote = await getQuote(ctx.workspaceId, branded<"QuoteId">(id));
  if (!quote) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Build the element before the try/catch - see invoices pdf route for rationale.
  const workspace = await getWorkspace(ctx.workspaceId).catch(() => null);
  const element = <QuoteDocument quote={quote} workspaceName={workspace?.name ?? null} />;
  try {
    const buffer = await renderPdf(element);
    return pdfResponse(buffer, `${quote.number}.pdf`);
  } catch (err) {
    console.error("[quotes/pdf] render failed:", err);
    return NextResponse.json({ error: "Failed to render PDF." }, { status: 502 });
  }
}
