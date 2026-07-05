import { formatCents } from "@/platform/billing/pricing";
import { platformLabel } from "@/shared/constants/drive-platforms";
import { Card, CardContent } from "@/shared/ui/card";
import { Sparkline } from "@/shared/components/sparkline";
import { formatKm, type DriveSummary, type MonthlyDrivePoint } from "@/modules/drive/calc";
import type { Period } from "@/shared/utils/periods";

/**
 * Drive summary header + per-platform breakdown + monthly-earnings sparkline (Phase 7).
 * Server component — pure SVG, no client JS. The summary is the period overview (respects
 * the `platform` filter, not the free-text search); the list below the page is the filtered
 * view.
 *
 * Earnings is emerald; distance is foreground; trips count is foreground. The sparkline is a
 * minimal dependency-free inline SVG of monthly earnings with native `<title>` tooltips
 * (mirrors `BooksSparkline`; extraction to a shared `<Sparkline>` is a documented future
 * cleanup). All money renders use `tabular-nums` (per `globals.css`).
 */

const PERIOD_LABEL: Record<Period, string> = {
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

      <PlatformBreakdownCard rows={summary.byPlatform} currency={currency} empty={empty} />

      <SparklineCard monthly={summary.monthly} currency={currency} empty={empty} />
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

function PlatformBreakdownCard({
  rows,
  currency,
  empty,
}: {
  rows: DriveSummary["byPlatform"];
  currency: string;
  empty: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-foreground">Earnings by platform</h3>
        {empty || rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No activity in this period.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 font-medium">
                  Platform
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Trips
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Distance
                </th>
                <th scope="col" className="py-1.5 pl-4 text-right font-medium">
                  Earnings
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const label = platformLabel(r.platform) ?? r.platform;
                return (
                  <tr key={r.platform}>
                    <td className="py-1.5 text-foreground">{label}</td>
                    <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                      {r.tripsCount}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                      {formatKm(r.distanceMeters)}
                    </td>
                    <td className="py-1.5 pl-4 text-right font-medium tabular-nums text-foreground">
                      {formatCents(r.earningsCents, currency)}
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
            <DriveSparkline monthly={monthly} currency={currency} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Sparkline ---------------------------------------------------------------

/**
 * Monthly-earnings sparkline. Thin wrapper over the shared `<Sparkline>` (extracted in Phase 9)
 * — maps `MonthlyDrivePoint` to the generic `points` shape and pre-formats each tooltip label
 * with `formatCents`. The SVG math + insufficient-data caption live in shared.
 */
function DriveSparkline({ monthly, currency }: { monthly: MonthlyDrivePoint[]; currency: string }) {
  return (
    <Sparkline
      ariaLabel="Monthly earnings trend"
      points={monthly.map((m) => ({
        month: m.month,
        value: m.earningsCents,
        label: formatCents(m.earningsCents, currency),
      }))}
    />
  );
}
