import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { BarChart, type BarChartPoint } from "@/shared/components/bar-chart";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { loadTaxPage } from "./actions";
import { LodgeQuarterButton } from "./lodge-quarter-button";

export const metadata = { title: "Tax" };
export const dynamic = "force-dynamic";

const CURRENCY = "AUD";

export default async function TaxPage() {
  const data = await loadTaxPage();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;

  const { gstSummary, lodgedPeriods, canManage, currentQuarter } = data;

  // Current-quarter BAS: GST collected − GST paid = net GST (obligation or refund).
  const currentPoint = gstSummary.byQuarter.find(
    (q) => q.fiscalYear === currentQuarter.fiscalYear && q.quarter === currentQuarter.quarter,
  );
  const currentNetGstCents = currentPoint?.netGstCents ?? 0;
  const currentCollectedCents = currentPoint?.gstCollectedCents ?? 0;
  const currentPaidCents = currentPoint?.gstPaidCents ?? 0;

  // Bar chart: net GST per quarter. GstQuarterPoint → BarChartPoint.
  const chartPoints: BarChartPoint[] = gstSummary.byQuarter.map((q) => ({
    key: q.label,
    label: `Q${q.quarter}`,
    value: q.netGstCents,
    valueLabel: formatCents(q.netGstCents, CURRENCY),
  }));

  // Tax runway: project the next-quarter obligation from the most recent quarter's
  // net GST. If the current quarter has data, carry it forward; otherwise use the
  // last quarter in the series. Zero when there's no GST history at all.
  const lastPoint = gstSummary.byQuarter[gstSummary.byQuarter.length - 1];
  const projectedNextQuarterCents = currentPoint?.netGstCents ?? lastPoint?.netGstCents ?? 0;

  const currentLabel = `${currentQuarter.fiscalYear}-Q${currentQuarter.quarter}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tax</h1>
        <p className="text-sm text-muted-foreground">
          GST/BAS position by quarter. Lodge a quarter to lock a snapshot.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              GST collected
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-500">
              {formatCents(currentCollectedCents, CURRENCY)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              GST paid
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {formatCents(currentPaidCents, CURRENCY)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Net GST ({currentLabel})
            </p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                currentNetGstCents >= 0
                  ? "text-destructive"
                  : "text-emerald-600 dark:text-emerald-500"
              }`}
            >
              {formatCents(currentNetGstCents, CURRENCY)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {currentNetGstCents >= 0 ? "Owed to the ATO" : "Refund due"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-medium text-foreground">Net GST by quarter</h3>
          <BarChart ariaLabel="Net GST by financial-year quarter" points={chartPoints} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="text-sm font-medium text-foreground">Tax runway</h3>
            <p className="text-xs text-muted-foreground">
              Projected next-quarter obligation, based on the most recent quarter&apos;s net GST
              position.
            </p>
            <p
              className={`text-2xl font-semibold tabular-nums ${
                projectedNextQuarterCents >= 0
                  ? "text-destructive"
                  : "text-emerald-600 dark:text-emerald-500"
              }`}
            >
              {formatCents(projectedNextQuarterCents, CURRENCY)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="text-sm font-medium text-foreground">Lodge this quarter</h3>
            <p className="text-xs text-muted-foreground">
              Locks a snapshot of {currentLabel}&apos;s GST position. Re-lodging re-snapshots the
              amounts.
            </p>
            {canManage ? (
              <LodgeQuarterButton
                fiscalYear={currentQuarter.fiscalYear}
                quarter={currentQuarter.quarter}
                label={currentLabel}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                You don&apos;t have permission to lodge quarters.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-foreground">Lodged quarters</h3>
          {lodgedPeriods.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No quarters lodged yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-0 py-2 font-medium">
                    Period
                  </th>
                  <th scope="col" className="px-0 py-2 text-right font-medium">
                    GST collected
                  </th>
                  <th scope="col" className="px-0 py-2 text-right font-medium">
                    GST paid
                  </th>
                  <th scope="col" className="px-0 py-2 text-right font-medium">
                    Net GST
                  </th>
                  <th scope="col" className="px-0 py-2 text-right font-medium">
                    Lodged
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lodgedPeriods.map((p) => (
                  <tr key={p.id}>
                    <td className="px-0 py-2">
                      <Badge variant="secondary">{p.periodLabel}</Badge>
                    </td>
                    <td className="px-0 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-500">
                      {formatCents(p.gstCollectedCents, CURRENCY)}
                    </td>
                    <td className="px-0 py-2 text-right tabular-nums text-foreground">
                      {formatCents(p.gstPaidCents, CURRENCY)}
                    </td>
                    <td
                      className={`px-0 py-2 text-right font-medium tabular-nums ${
                        p.netGstCents >= 0
                          ? "text-destructive"
                          : "text-emerald-600 dark:text-emerald-500"
                      }`}
                    >
                      {formatCents(p.netGstCents, CURRENCY)}
                    </td>
                    <td className="px-0 py-2 text-right text-muted-foreground">
                      {p.lodgedAt ? formatDate(p.lodgedAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
