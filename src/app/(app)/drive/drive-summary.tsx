import { formatCents } from "@/platform/billing/pricing";
import { platformLabel } from "@/shared/constants/drive-platforms";
import { Card, CardContent } from "@/shared/ui/card";
import { Sparkline } from "@/shared/components/sparkline";
import { BarChart, type BarChartPoint } from "@/shared/components/bar-chart";
import { formatWeekLabel } from "@/shared/utils/format-date";
import {
  formatKm,
  type DriveSummary,
  type MonthlyDrivePoint,
  type WeeklyDrivePoint,
} from "@/modules/drive/calc";
import type { Period } from "@/shared/utils/periods";

/**
 * Drive summary header + per-platform bar chart + deduction/profit card + monthly and weekly
 * sparklines (Phase 7, extended in Wave 2). Server component — pure SVG, no client JS.
 *
 * Wave 2 additions:
 * - The per-platform breakdown table is replaced by the shared `<BarChart>` (categorical bars).
 * - A deduction/profit card shows the mileage deduction (km × rate), total vehicle expenses,
 *   and net profit (earnings − expenses − mileage deduction).
 * - A weekly sparkline joins the monthly one (keyed by `formatWeekLabel`).
 *
 * All money renders use `tabular-nums` (per `globals.css`).
 */

const PERIOD_LABEL: Record<Period, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  all: "All time",
};

export function DriveSummary({
  summary,
  currency,
  period,
}: {
  summary: DriveSummary;
  currency: string;
  period: Period;
}) {
  const empty = summary.earningsCount === 0 && summary.tripsCount === 0;

  return (
    <section className="space-y-4" aria-label={`Drive summary — ${PERIOD_LABEL[period]}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Earnings"
          value={formatCents(summary.totalEarningsCents, currency)}
          tone="income"
        />
        <StatCard
          label="Distance"
          value={formatKm(summary.totalDistanceMeters)}
          tone="foreground"
        />
        <StatCard label="Trips" value={String(summary.tripsCount)} tone="foreground" />
      </div>

      <DeductionProfitCard summary={summary} currency={currency} empty={empty} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PlatformBreakdownCard rows={summary.byPlatform} currency={currency} empty={empty} />
        <SparklineCard monthly={summary.monthly} currency={currency} empty={empty} />
      </div>

      <WeeklySparklineCard weekly={summary.weekly} currency={currency} empty={empty} />
    </section>
  );
}

type StatTone = "income" | "foreground" | "danger";

const TONE_CLASS: Record<StatTone, string> = {
  income: "text-emerald-600",
  foreground: "text-foreground",
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

function DeductionProfitCard({
  summary,
  currency,
  empty,
}: {
  summary: DriveSummary;
  currency: string;
  empty: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">Deductions & profit</h3>
        {empty && summary.totalExpensesCents === 0 && summary.mileageDeductionCents === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity in this period.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <DeductionRow
              label="Mileage deduction"
              detail={`${formatKm(summary.totalDistanceMeters)} × ${
                summary.mileageDeductionCents > 0
                  ? `${(summary.totalDistanceMeters / 1000).toFixed(0)} km`
                  : "—"
              }`}
              value={formatCents(summary.mileageDeductionCents, currency)}
            />
            <DeductionRow
              label="Vehicle expenses"
              detail={`${summary.totalExpensesCents > 0 ? "Logged" : "None"}`}
              value={formatCents(summary.totalExpensesCents, currency)}
            />
            <DeductionRow
              label="Net profit"
              detail="Earnings − expenses − deduction"
              value={formatCents(summary.profitCents, currency)}
              tone={summary.profitCents < 0 ? "danger" : "income"}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeductionRow({
  label,
  detail,
  value,
  tone = "foreground",
}: {
  label: string;
  detail: string;
  value: string;
  tone?: StatTone;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function PlatformBreakdownCard({
  rows,
  currency,
  empty,
}: {
  rows: DriveSummary["byPlatform"];
  currency: string;
  empty: boolean;
}) {
  const points: BarChartPoint[] = rows.map((r) => ({
    key: r.platform,
    label: platformLabel(r.platform) ?? r.platform,
    value: r.earningsCents,
    valueLabel: formatCents(r.earningsCents, currency),
  }));

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">Earnings by platform</h3>
        {empty || rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity in this period.</p>
        ) : (
          <div className="mt-3">
            <BarChart points={points} ariaLabel="Earnings by platform" />
          </div>
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
  monthly: MonthlyDrivePoint[];
  currency: string;
  empty: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">Earnings over time</h3>
        {empty || monthly.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity in this period.</p>
        ) : (
          <div className="mt-2">
            <Sparkline
              ariaLabel="Monthly earnings trend"
              points={monthly.map((m) => ({
                month: m.month,
                value: m.earningsCents,
                label: formatCents(m.earningsCents, currency),
              }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklySparklineCard({
  weekly,
  currency,
  empty,
}: {
  weekly: WeeklyDrivePoint[];
  currency: string;
  empty: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">Weekly earnings</h3>
        {empty || weekly.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity in this period.</p>
        ) : (
          <div className="mt-2">
            <Sparkline
              ariaLabel="Weekly earnings trend"
              points={weekly.map((w) => ({
                month: formatWeekLabel(new Date(w.week + "T00:00:00Z")),
                value: w.earningsCents,
                label: formatCents(w.earningsCents, currency),
              }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
