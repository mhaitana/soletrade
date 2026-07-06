import "server-only";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextResponse } from "next/server";

/**
 * PDF rendering primitive (Wave 4). Server-side via `@react-pdf/renderer` — no headless
 * browser, Vercel-compatible. Renders a `<Document>` React element to a `Buffer` of PDF bytes.
 *
 * Boundary: server-only. Document components (in `./documents`) are pure React presentational
 * components that reuse the shared calc functions (`computeLineItemTotals`, Books
 * `summarizeTransactions`) for the numbers — single source of truth, no duplication.
 */
export async function renderPdf(document: React.ReactElement<DocumentProps>): Promise<Buffer> {
  return renderToBuffer(document);
}

/**
 * Build a `NextResponse` that serves `buffer` (PDF bytes) as a `application/pdf` download with the
 * given filename. Centralized so route handlers don't each fight the `Buffer<ArrayBufferLike>` →
 * `BodyInit` generic mismatch — the underlying bytes are sliced out as a standalone `ArrayBuffer`
 * (unambiguous `BodyInit` member).
 */
export function pdfResponse(buffer: Buffer, filename: string): NextResponse {
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
