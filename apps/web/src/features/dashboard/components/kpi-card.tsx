import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDelta, type Delta } from "@/utils/delta";
import type { KpiCardData } from "@/features/dashboard/api/actions";

/**
 * Headline KPI card for the cross-module dashboard (Phase 9). Server component - no client JS.
 *
 * Renders the metric label + value (`tabular-nums` on the figure per the brief's money rule) and,
 * when the metric is period-bound, a tactile pill-styled delta badge vs the previous period. The delta is **never
 * color-only**: an arrow icon (↑/↓/→) + the accessible `formatDelta` text convey direction, with
 * semantic tint pills (success/destructive/muted) as high-contrast indicators. Snapshot metrics pass `delta: null`
 * and render no badge.
 */

const DELTA_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
  new: Sparkles,
  none: null,
} as const;

const DELTA_STYLE = {
  up: "rounded-full bg-success/10 text-success border border-success/20",
  down: "rounded-full bg-destructive/10 text-destructive border border-destructive/20",
  flat: "rounded-full bg-muted text-muted-foreground border border-border/60",
  new: "rounded-full bg-success/10 text-success border border-success/20",
  none: "",
} as const;

function DeltaBadge({ delta, periodNoun }: { delta: Delta; periodNoun: string }) {
  const Icon = DELTA_ICON[delta.kind];
  if (!Icon) return null; // `none` - both periods zero, no badge.
  const text = formatDelta(delta, periodNoun);
  if (!text) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        DELTA_STYLE[delta.kind],
      )}
      aria-label={text}
    >
      <Icon className="size-3" aria-hidden />
      {text}
    </span>
  );
}

export function KpiCard({
  kpi,
  periodNoun,
}: {
  kpi: KpiCardData;
  /** "last month" / "last quarter" / "last year" - the delta badge noun. */
  periodNoun: string;
}) {
  const empty = kpi.value === null;
  return (
    <Link
      href={kpi.href}
      aria-label={`${kpi.label}: ${kpi.value ?? kpi.emptyLabel}`}
      className="block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Card className="h-full rounded-2xl border border-border/80 bg-card shadow-xs transition-all hover:shadow-md hover:bg-card max-sm:gap-0 max-sm:py-0">
        <CardContent className="space-y-2 p-5 max-sm:flex max-sm:min-h-28 max-sm:flex-col max-sm:justify-between max-sm:p-4">
          <p className="text-sm font-medium text-muted-foreground max-sm:text-xs max-sm:leading-4">
            {kpi.label}
          </p>
          {empty ? (
            <div className="space-y-1">
              <p className="text-2xl font-semibold tracking-tight text-muted-foreground max-sm:text-xl">
                -
              </p>
              <p className="text-xs font-medium leading-4 text-brand-blue max-sm:text-[0.6875rem]">
                {kpi.emptyLabel} →
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="font-mono text-2xl font-semibold leading-tight tracking-tight tabular-nums text-foreground max-sm:text-[clamp(1.125rem,5vw,1.5rem)]">
                {kpi.value}
              </p>
              {kpi.delta ? (
                <div>
                  <DeltaBadge delta={kpi.delta} periodNoun={periodNoun} />
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
