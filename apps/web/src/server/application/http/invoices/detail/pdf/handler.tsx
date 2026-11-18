import "server-only";
import { NextResponse } from "next/server";
import { tryWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { getInvoice } from "@/server/domains/invoices/index";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { branded } from "@/types/ids";
import { resolveInvoicePaymentMethods } from "@/types/payment-methods";
import { renderPdf, pdfResponse } from "@/server/infrastructure/pdf/index";
import { InvoiceDocument } from "@/server/domains/invoices/documents/invoice-document";

/**
 * Invoice PDF download (Wave 4). Workspace-member-only - the public invoice page (`/i/[token]`)
 * already serves the public view; this route renders a downloadable PDF for the workspace's own
 * records + is reused to attach the PDF to the InvoiceSent email. IDOR-safe via `getInvoice`
 * (workspaceId-scoped). Auth: resolved workspace context (401) + `view:invoice` (403).
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "view:invoice")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await params;
  const [invoice, workspace] = await Promise.all([
    getInvoice(ctx.workspaceId, branded<"InvoiceId">(id)),
    getWorkspace(ctx.workspaceId).catch(() => null),
  ]);
  if (!invoice) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Build the element before the try/catch - React renders lazily, so a JSX error inside the
  // try wouldn't be caught by it (react-hooks/error-boundaries). `renderPdf` (renderToBuffer)
  // is the call that actually renders + can throw, so only that is wrapped.
  const element = (
    <InvoiceDocument
      invoice={{
        ...invoice,
        paymentMethods: resolveInvoicePaymentMethods(
          invoice.paymentMethods,
          workspace?.paymentMethods ?? null,
        ),
      }}
      workspaceName={workspace?.name ?? null}
    />
  );
  try {
    const buffer = await renderPdf(element);
    return pdfResponse(buffer, `${invoice.number}.pdf`);
  } catch (err) {
    console.error("[invoices/pdf] render failed:", err);
    return NextResponse.json({ error: "Failed to render PDF." }, { status: 502 });
  }
}
