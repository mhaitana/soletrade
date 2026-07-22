import { formatCents } from "@/platform/billing/pricing";
import { categoryLabel } from "@/shared/constants/books-categories";
import { Card, CardContent } from "@/shared/ui/card";
import { Sparkline } from "@/shared/components/sparkline";
import type { CategoryBreakdown, MonthlyNetPoint, TransactionSummary } from "@/modules/books/calc";
import type { Period } from "@/shared/utils/periods";
import type { BookType } from "@/server/db/enums";

/**
 * Books summary header + per-category breakdown + monthly-net sparkline (Phase 6b).
 * Server component - pure SVG, no client JS. The summary is the period overview (respects
 * the `type` filter, not the free-text search); the list below the page is the filtered view.
 *
 * All money renders use `tabular-nums` (per `globals.css`). Income is emerald, expense is
 * foreground, net is emerald when ≥0 else destructive red. The sparkline is a minimal
 * dependency-free inline SVG with native `<title>` tooltips; a richer Recharts line chart
 * comes with the cross-module dashboard phase.
 */

const PERIOD_LABEL: Record<Period, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "Current FY",
  calendar: "Calendar year",
  all: "All time",
};

export function BooksSummary({
  summary,
  currency,
  period,
}: {
  summary: TransactionSummary;
  currency: string;
  period: Period;
}) {
  const empty = summary.count === 0;

  return (
    <section className="space-y-4" aria-label={`Books summary - ${PERIOD_LABEL[period]}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Income" value={formatCents(summary.incomeCents, currency)} tone="income" />
        <StatCard
          label="Expense"
          value={formatCents(summary.expenseCents, currency)}
          tone="expense"
        />
        <StatCard
          label="Net"
          value={formatCents(summary.netCents, currency)}
          tone={summary.netCents >= 0 ? "income" : "danger"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="GST collected"
          value={formatCents(summary.gstCollectedCents, currency)}
          tone="income"
        />
        <StatCard
          label="GST paid"
          value={formatCents(summary.gstPaidCents, currency)}
          tone="expense"
        />
        <StatCard
          label="Net GST"
          value={formatCents(summary.netGstCents, currency)}
          tone={summary.netGstCents >= 0 ? "danger" : "income"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryBreakdownCard
          type="income"
          rows={summary.byCategory.filter((r) => r.type === "income")}
          currency={currency}
          empty={empty}
        />
        <CategoryBreakdownCard
          type="expense"
          rows={summary.byCategory.filter((r) => r.type === "expense")}
          currency={currency}
          empty={empty}
        />
      </div>

      <SparklineCard monthly={summary.monthly} currency={currency} empty={empty} />
    </section>
  );
}

type StatTone = "income" | "expense" | "danger";

const TONE_CLASS: Record<StatTone, string> = {
  income: "text-emerald-600 dark:text-emerald-500",
  expense: "text-foreground",
  danger: "text-destructive",
};

function StatCard({ label, value, tone }: { label: string; value: string; tone: StatTone }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function CategoryBreakdownCard({
  type,
  rows,
  currency,
  empty,
}: {
  type: BookType;
  rows: CategoryBreakdown[];
  currency: string;
  empty: boolean;
}) {
  const heading = type === "income" ? "Income by category" : "Expense by category";
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">{heading}</h3>
        {empty || rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No transactions in this period.</p>
        ) : (
          <>
            <table className="hidden mt-2 w-full text-sm sm:table">
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const label = categoryLabel(type, r.category) ?? r.category;
                  return (
                    <tr key={r.category}>
                      <td className="py-1.5 text-foreground">{label}</td>
                      <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                        {r.count}
                      </td>
                      <td className="py-1.5 pl-4 text-right font-medium tabular-nums text-foreground">
                        {formatCents(r.amountCents, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div
              className="sm:hidden mt-2 divide-y divide-border"
              data-testid="books-category-mobile"
            >
              {rows.map((r) => {
                const label = categoryLabel(type, r.category) ?? r.category;
                return (
                  <div key={r.category} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-foreground">{label}</span>
                      <span className="text-sm font-medium tabular-nums text-foreground">
                        {formatCents(r.amountCents, currency)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.count} transaction{r.count === 1 ? "" : "s"}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SparklineCard({
  monthly,
  currency,
  empty,
}: {
  monthly: MonthlyNetPoint[];
  currency: string;
  empty: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">Net over time</h3>
        {empty || monthly.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No transactions in this period.</p>
        ) : (
          <div className="mt-2">
            <BooksSparkline monthly={monthly} currency={currency} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Sparkline ---------------------------------------------------------------

/**
 * Monthly-net sparkline. Thin wrapper over the shared `<Sparkline>` (extracted in Phase 9) -
 * maps `MonthlyNetPoint` to the generic `points` shape and pre-formats each tooltip label with
 * `formatCents`. The SVG math + zero baseline + insufficient-data caption live in shared.
 */
function BooksSparkline({ monthly, currency }: { monthly: MonthlyNetPoint[]; currency: string }) {
  return (
    <Sparkline
      ariaLabel="Monthly net trend"
      points={monthly.map((m) => ({
        month: m.month,
        value: m.netCents,
        label: formatCents(m.netCents, currency),
      }))}
    />
  );
}
