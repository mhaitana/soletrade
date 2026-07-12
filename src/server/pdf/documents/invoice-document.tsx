import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { brand } from "@/config/brand";

/**
 * Invoice PDF document (Wave 4). Renders to PDF bytes via `renderPdf` - a workspace-member-only
 * download + email attachment. Mirrors the public invoice page layout (brand + number + customer +
 * line items + totals + notes). The numbers come straight from the stored invoice row (already
 * computed via `computeLineItemTotals` on create/update), so this document is purely presentational.
 *
 * Boundary: this module defines its own prop interfaces (structurally compatible with the
 * invoices module's `InvoiceWithItems`) so neither `@/server/pdf` nor the notifications platform
 * needs to import `@/modules/*`. Both the route handler (passing the module row) and the
 * notifications handler (constructing from DB rows) feed the same shape.
 */

export interface InvoicePdfLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface InvoicePdfData {
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  taxRate: number;
  /** True = unit prices are gross (tax-inclusive); tax is back-calculated from the total. */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  customerName: string | null;
  lineItems: InvoicePdfLineItem[];
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#0f172a" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 14, marginBottom: 24 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { color: "#64748b", fontSize: 9 },
  heading: { fontSize: 22, marginBottom: 16 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 6,
    marginBottom: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  colDesc: { flex: 1 },
  colQty: { width: 60, textAlign: "right" },
  colPrice: { width: 90, textAlign: "right" },
  colAmount: { width: 90, textAlign: "right" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#0f172a",
  },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#64748b" },
  sectionGap: { marginTop: 24 },
});

export function InvoiceDocument({
  invoice,
  workspaceName,
}: {
  invoice: InvoicePdfData;
  workspaceName: string | null;
}) {
  const customerName = invoice.customerName ?? "Walk-in customer";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>{brand.productName.toLowerCase()}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>From</Text>
          <Text style={styles.label}>Invoice</Text>
        </View>
        <View style={styles.row}>
          <Text>{workspaceName ?? brand.productName}</Text>
          <Text style={styles.bold}>{invoice.number}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>{customerName}</Text>
          <Text style={styles.muted}>Issued {fmtDate(invoice.issueDate)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>{invoice.status.toUpperCase()}</Text>
          <Text style={styles.muted}>
            {invoice.dueDate ? `Due ${fmtDate(invoice.dueDate)}` : ""}
          </Text>
        </View>

        <Text style={[styles.heading, styles.sectionGap]}>Invoice {invoice.number}</Text>

        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colPrice}>Unit</Text>
          <Text style={styles.colAmount}>Amount</Text>
        </View>
        {invoice.lineItems.map((it) => (
          <View key={it.id} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDesc}>{it.description}</Text>
            <Text style={styles.colQty}>{it.quantity}</Text>
            <Text style={styles.colPrice}>{money(it.unitPriceCents, invoice.currency)}</Text>
            <Text style={styles.colAmount}>{money(it.amountCents, invoice.currency)}</Text>
          </View>
        ))}

        <View style={styles.sectionGap}>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>
              {invoice.pricesIncludeTax ? "Subtotal (ex-tax)" : "Subtotal"}
            </Text>
            <Text>{money(invoice.subtotalCents, invoice.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>
              Tax ({invoice.taxRate}%{invoice.pricesIncludeTax ? ", included" : ""})
            </Text>
            <Text>{money(invoice.taxCents, invoice.currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.bold}>Total</Text>
            <Text style={styles.bold}>{money(invoice.totalCents, invoice.currency)}</Text>
          </View>
        </View>

        {invoice.notes ? (
          <View style={styles.sectionGap}>
            <Text style={styles.label}>Notes</Text>
            <Text style={{ marginTop: 4 }}>{invoice.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
