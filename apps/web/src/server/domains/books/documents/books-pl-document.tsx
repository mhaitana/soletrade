import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { TransactionSummary } from "@/lib/domain/books/calc";
import { categoryLabel } from "@/config/books-categories";
import { brand } from "@/config/brand";
import type { WorkspaceRow } from "@/lib/domain/workspaces/types";

/**
 * Books P&L report PDF (Wave 4). Renders the period summary (income/expense/net + by-category +
 * GST) computed by the pure `summarizeTransactions` - the route does the aggregation and passes the
 * result in, so the document is purely presentational (no DB, no calc duplication).
 */

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.abs(cents / 100).toFixed(2)}`;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#0f172a" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 14, marginBottom: 24 },
  heading: { fontSize: 22, marginBottom: 4 },
  subheading: { color: "#64748b", fontSize: 10, marginBottom: 20 },
  kpiRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  kpi: { flex: 1, paddingRight: 8 },
  kpiLabel: { color: "#64748b", fontSize: 9, marginBottom: 4 },
  kpiValue: { fontFamily: "Helvetica-Bold", fontSize: 16 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 8, marginTop: 16 },
  catRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#64748b" },
});

export function BooksPlDocument({
  summary,
  workspace,
  periodLabel,
}: {
  summary: TransactionSummary;
  workspace: Pick<WorkspaceRow, "name"> | null;
  periodLabel: string;
}) {
  const incomeCats = summary.byCategory.filter((c) => c.type === "income");
  const expenseCats = summary.byCategory.filter((c) => c.type === "expense");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>{brand.wordmark}</Text>
        <Text style={styles.heading}>Profit &amp; Loss</Text>
        <Text style={styles.subheading}>
          {workspace?.name ?? brand.productName} · {periodLabel}
        </Text>

        <View style={styles.kpiRow}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Income</Text>
            <Text style={styles.kpiValue}>{money(summary.incomeCents)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Expenses</Text>
            <Text style={styles.kpiValue}>{money(summary.expenseCents)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Net</Text>
            <Text style={styles.kpiValue}>{money(summary.netCents)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Income by category</Text>
        {incomeCats.length === 0 ? (
          <Text style={styles.muted}>No income in this period.</Text>
        ) : (
          incomeCats.map((c) => (
            <View key={`${c.type}-${c.category}`} style={styles.catRow}>
              <Text>{categoryLabel(c.type, c.category) ?? c.category}</Text>
              <Text>{money(c.amountCents)}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Expenses by category</Text>
        {expenseCats.length === 0 ? (
          <Text style={styles.muted}>No expenses in this period.</Text>
        ) : (
          expenseCats.map((c) => (
            <View key={`${c.type}-${c.category}`} style={styles.catRow}>
              <Text>{categoryLabel(c.type, c.category) ?? c.category}</Text>
              <Text>{money(c.amountCents)}</Text>
            </View>
          ))
        )}

        {summary.netGstCents !== 0 ? (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionTitle}>GST</Text>
            <View style={styles.catRow}>
              <Text style={styles.muted}>GST collected</Text>
              <Text>{money(summary.gstCollectedCents)}</Text>
            </View>
            <View style={styles.catRow}>
              <Text style={styles.muted}>GST paid (claimable)</Text>
              <Text>{money(summary.gstPaidCents)}</Text>
            </View>
            <View style={styles.catRow}>
              <Text style={styles.bold}>Net GST</Text>
              <Text style={styles.bold}>{money(summary.netGstCents)}</Text>
            </View>
          </View>
        ) : null}

        <View
          style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 8 }}
        >
          <View style={styles.catRow}>
            <Text style={styles.bold}>Net result</Text>
            <Text style={styles.bold}>{money(summary.netCents)}</Text>
          </View>
          <Text style={[styles.muted, { marginTop: 4 }]}>
            {summary.count} transaction{summary.count === 1 ? "" : "s"} in period.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
