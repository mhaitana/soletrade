import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";
import { formatDelta, type Delta } from "@/shared/utils/delta";
import type { KpiCardData } from "./actions";

/**
 * Headline KPI card for the cross-module dashboard (Phase 9). Server component - no client JS.
 *
 * Renders the metric label + value (`tabular-nums` on the figure per the brief's money rule) and,
 * when the metric is period-bound, a delta badge vs the previous period. The delta is **never
 * color-only**: an arrow icon (↑/↓/→) + the accessible `formatDelta` text convey direction, with
 * color (emerald/rose/slate) as a redundant secondary signal (per `pages/dashboard.md` + the
 * `color-not-only` a11y rule). Snapshot metrics (outstanding, pending quotes) pass `delta: null`
 * and render no badge. A not-installed module's KPI renders an empty-state CTA linking to
 * `/settings/modules`.
 */

const DELTA_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
  new: Sparkles,
  none: null,
} as const;

const DELTA_COLOR = {
  up: "text-emerald-600 dark:text-emerald-500",
  down: "text-rose-600 dark:text-rose-500",
  flat: "text-muted-foreground",
  new: "text-emerald-600 dark:text-emerald-500",
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
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        DELTA_COLOR[delta.kind],
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
      className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Card className="h-full transition-colors hover:bg-muted/40 max-sm:gap-0 max-sm:py-0">
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
            <div className="space-y-1">
              <p className="font-mono text-2xl font-semibold leading-tight tracking-tight tabular-nums max-sm:text-[clamp(1.125rem,5vw,1.5rem)]">
                {kpi.value}
              </p>
              {kpi.delta ? <DeltaBadge delta={kpi.delta} periodNoun={periodNoun} /> : null}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
