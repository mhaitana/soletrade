import { describe, expect, it } from "vitest";
import { Document, Page, Text } from "@react-pdf/renderer";
import { renderPdf, pdfResponse } from "@/server/infrastructure/pdf";

/**
 * PDF pipeline smoke tests (Wave 4 G1). Renders a minimal document with the real
 * `@react-pdf/renderer` (no headless browser, no DB) and asserts the bytes are a valid PDF.
 * The `pdfResponse` helper is pure - it slices the buffer's bytes out as a standalone
 * `ArrayBuffer` and sets the download headers.
 */
describe("renderPdf + pdfResponse", () => {
  it("renders a real PDF document (bytes start with the %PDF magic)", async () => {
    const element = (
      <Document>
        <Page size="A4">
          <Text>Smoke test</Text>
        </Page>
      </Document>
    );
    const buffer = await renderPdf(element);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    // PDF files begin with %PDF-.
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("pdfResponse sets application/pdf + attachment headers", async () => {
    const buffer = await renderPdf(
      <Document>
        <Page size="A4">
          <Text>x</Text>
        </Page>
      </Document>,
    );
    const res = pdfResponse(buffer, "INV-2026-0001.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="INV-2026-0001.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The body is the buffer's bytes (as a standalone ArrayBuffer).
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(buffer.length);
    expect(new TextDecoder("latin1").decode(new Uint8Array(body, 0, 5))).toBe("%PDF-");
  });
});
