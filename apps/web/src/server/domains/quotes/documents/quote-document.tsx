import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { brand } from "@/config/brand";
import {
  DocumentBrandFooter,
  DocumentBrandHeader,
} from "@/server/infrastructure/pdf/documents/document-brand";

/**
 * Quote PDF document (Wave 4). Mirrors the public quote page (brand + number + customer + line
 * items + sections + totals + terms). The stored quote row already carries computed totals.
 *
 * Boundary: local prop interfaces (structurally compatible with the quotes module's
 * `QuoteWithItems`) - no `@/modules/*` import. See `invoice-document.tsx` for the rationale.
 */

export interface QuotePdfLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface QuotePdfSection {
  id: string;
  title: string;
  body: string;
  optional: boolean;
}

export interface QuotePdfData {
  number: string;
  status: string;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  taxRate: number;
  /** True = unit prices are gross (tax-inclusive); tax is back-calculated from the total. */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  termsConditions: string | null;
  customerName: string | null;
  lineItems: QuotePdfLineItem[];
  sections: QuotePdfSection[];
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontSize: 11, fontFamily: "Helvetica", color: "#0f172a" },
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
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 4 },
  sectionBody: { marginBottom: 8 },
});

export function QuoteDocument({
  quote,
  workspaceName,
}: {
  quote: QuotePdfData;
  workspaceName: string | null;
}) {
  const customerName = quote.customerName ?? "Walk-in customer";
  return (
    <Document
      title={`Quote ${quote.number}`}
      author={workspaceName ?? brand.productName}
      creator={brand.productName}
      producer={brand.companyName}
    >
      <Page size="A4" style={styles.page}>
        <DocumentBrandHeader />
        <View style={styles.row}>
          <Text style={styles.label}>From</Text>
          <Text style={styles.label}>Quote</Text>
        </View>
        <View style={styles.row}>
          <Text>{workspaceName ?? brand.productName}</Text>
          <Text style={styles.bold}>{quote.number}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>{customerName}</Text>
          <Text style={styles.muted}>Issued {fmtDate(quote.issueDate)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>{quote.status.toUpperCase()}</Text>
          <Text style={styles.muted}>
            {quote.validUntil ? `Valid until ${fmtDate(quote.validUntil)}` : ""}
          </Text>
        </View>

        <Text style={[styles.heading, styles.sectionGap]}>Quote {quote.number}</Text>

        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colPrice}>Unit</Text>
          <Text style={styles.colAmount}>Amount</Text>
        </View>
        {quote.lineItems.map((it) => (
          <View key={it.id} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDesc}>{it.description}</Text>
            <Text style={styles.colQty}>{it.quantity}</Text>
            <Text style={styles.colPrice}>{money(it.unitPriceCents, quote.currency)}</Text>
            <Text style={styles.colAmount}>{money(it.amountCents, quote.currency)}</Text>
          </View>
        ))}

        <View style={styles.sectionGap}>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>
              {quote.pricesIncludeTax ? "Subtotal (ex-tax)" : "Subtotal"}
            </Text>
            <Text>{money(quote.subtotalCents, quote.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>
              Tax ({quote.taxRate}%{quote.pricesIncludeTax ? ", included" : ""})
            </Text>
            <Text>{money(quote.taxCents, quote.currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.bold}>Total</Text>
            <Text style={styles.bold}>{money(quote.totalCents, quote.currency)}</Text>
          </View>
        </View>

        {quote.sections.length > 0 ? (
          <View style={styles.sectionGap}>
            {quote.sections.map((s) => (
              <View key={s.id} style={{ marginBottom: 8 }}>
                <Text style={styles.sectionTitle}>
                  {s.title}
                  {s.optional ? " (optional)" : ""}
                </Text>
                <Text style={styles.sectionBody}>{s.body}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {quote.notes ? (
          <View style={styles.sectionGap}>
            <Text style={styles.label}>Notes</Text>
            <Text style={{ marginTop: 4 }}>{quote.notes}</Text>
          </View>
        ) : null}

        {quote.termsConditions ? (
          <View style={styles.sectionGap}>
            <Text style={styles.label}>Terms &amp; conditions</Text>
            <Text style={{ marginTop: 4 }}>{quote.termsConditions}</Text>
          </View>
        ) : null}
        <DocumentBrandFooter />
      </Page>
    </Document>
  );
}
