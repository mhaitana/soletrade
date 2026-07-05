import { formatCents } from "@/platform/billing/pricing";
import { categoryLabel } from "@/shared/constants/books-categories";
import { Card, CardContent } from "@/shared/ui/card";
import type { CategoryBreakdown, MonthlyNetPoint, TransactionSummary } from "@/modules/books/calc";
import type { Period } from "@/modules/books/periods";
import type { BookType } from "@/server/db/schema/enums";

/**
 * Books summary header + per-category breakdown + monthly-net sparkline (Phase 6b).
 * Server component — pure SVG, no client JS. The summary is the period overview (respects
 * the `type` filter, not the free-text search); the list below the page is the filtered view.
 *
 * All money renders use `tabular-nums` (per `globals.css`). Income is emerald, expense is
 * foreground, net is emerald when ≥0 else destructive red. The sparkline is a minimal
 * dependency-free inline SVG with native `<title>` tooltips; a richer Recharts line chart
 * comes with the cross-module dashboard phase.
 */

const PERIOD_LABEL: Record<Period, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
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
    <section className="space-y-4" aria-label={`Books summary — ${PERIOD_LABEL[period]}`}>
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
  income: "text-emerald-600",
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
          <table className="mt-2 w-full text-sm">
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

const SVG_W = 160;
const SVG_H = 48;
const PAD = 4;
const PRIMARY = "#2563EB";

/**
 * Minimal dependency-free inline SVG of monthly net. Each point has a `<title>` for the
 * native tooltip (`YYYY-MM: $X.XX`). Degenerate cases (1 point, all-zero) render a flat
 * line + an "Insufficient data" caption rather than a misleading chart.
 */
function BooksSparkline({ monthly, currency }: { monthly: MonthlyNetPoint[]; currency: string }) {
  const n = monthly.length;
  const nets = monthly.map((m) => m.netCents);
  let min = Math.min(...nets, 0);
  let max = Math.max(...nets, 0);
  if (min === max) {
    // All-equal (incl. all-zero): expand so the line sits at the vertical midpoint.
    min = Math.min(min, 0);
    max = Math.max(max, 0);
    if (min === max) {
      min -= 1;
      max += 1;
    }
  }
  const range = max - min;
  const x = (i: number) => PAD + (n === 1 ? SVG_W / 2 - PAD : (i / (n - 1)) * (SVG_W - 2 * PAD));
  const y = (v: number) => SVG_H - PAD - ((v - min) / range) * (SVG_H - 2 * PAD);

  const points = monthly.map((m, i) => `${x(i).toFixed(2)},${y(m.netCents).toFixed(2)}`);
  const polyline = points.join(" ");
  // Area fill down to the bottom of the chart.
  const areaPath = `${x(0).toFixed(2)},${(SVG_H - PAD).toFixed(2)} ${polyline} ${x(n - 1).toFixed(2)},${(SVG_H - PAD).toFixed(2)}`;

  const zeroY = y(0);
  const showZero = min < 0 && max > 0;
  const insufficient = n < 2 || nets.every((v) => v === 0);

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width={SVG_W}
        height={SVG_H}
        role="img"
        aria-label="Monthly net trend"
        className="text-foreground"
      >
        {showZero ? (
          <line
            x1={PAD}
            y1={zeroY}
            x2={SVG_W - PAD}
            y2={zeroY}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ) : null}
        <polygon points={areaPath} fill={PRIMARY} fillOpacity={0.2} />
        <polyline
          points={polyline}
          fill="none"
          stroke={PRIMARY}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {monthly.map((m, i) => (
          <circle key={m.month} cx={x(i)} cy={y(m.netCents)} r={2} fill={PRIMARY}>
            <title>
              {m.month}: {formatCents(m.netCents, currency)}
            </title>
          </circle>
        ))}
      </svg>
      {insufficient ? (
        <p className="text-xs text-muted-foreground">Insufficient data for a trend.</p>
      ) : null}
      <p className="text-xs text-muted-foreground tabular-nums">
        {monthly[0]!.month} – {monthly[n - 1]!.month}
      </p>
    </div>
  );
}
