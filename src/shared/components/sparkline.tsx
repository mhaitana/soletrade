/**
 * Shared inline-SVG sparkline (Phase 9). Extracted verbatim from the near-duplicate
 * `BooksSparkline` (`books-summary.tsx`) + `DriveSparkline` (`drive-summary.tsx`) — the two
 * differed only in which numeric field they plotted + the `aria-label`. This generic version
 * takes pre-shaped `points` so it stays boundary-clean: **shared imports nothing app-specific**
 * (no `@/platform/*`, no `@/modules/*`), so the caller formats the per-point tooltip `label`
 * (e.g. via `formatCents`) and passes it in.
 *
 * Server component — pure SVG, no client JS, no `"use client"`. Each point renders a `<circle>`
 * with a native `<title>` tooltip (`{month}: {label}`). Degenerate cases (1 point, all-zero)
 * render a flat line + an "Insufficient data" caption rather than a misleading chart. A dashed
 * zero baseline is drawn only when the series crosses zero (min < 0 && max > 0), so the same
 * component handles signed (Books net) and non-negative (Drive earnings, dashboard revenue)
 * series without a flag.
 *
 * Per the design spec `design-system/.../pages/dashboard.md`: primary `#2563EB`, 20% fill.
 * Hover tooltips are native `<title>` tags (no client JS); a richer Recharts view with axis
 * labels / dashed secondary series is a later opt-in (the user chose the shared-SVG approach
 * for Phase 9 — no new dependency, server-rendered).
 */

export interface SparklinePoint {
  /** ISO month "YYYY-MM" (or any x-axis caption key — rendered in the date-range caption). */
  month: string;
  /** The numeric value to plot (signed cents, meters, counts — whatever the caller passes). */
  value: number;
  /** Pre-formatted tooltip text for this point, e.g. "$1,234.56" or "12 paid". */
  label: string;
}

export interface SparklineProps {
  points: readonly SparklinePoint[];
  /** Accessible label for the `<svg role="img">`, e.g. "Monthly net trend". */
  ariaLabel: string;
}

const SVG_W = 160;
const SVG_H = 48;
const PAD = 4;
const PRIMARY = "#2563EB";

export function Sparkline({ points, ariaLabel }: SparklineProps) {
  const n = points.length;
  const values = points.map((p) => p.value);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
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

  const polyPoints = points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`);
  const polyline = polyPoints.join(" ");
  // Area fill down to the bottom of the chart.
  const areaPath = `${x(0).toFixed(2)},${(SVG_H - PAD).toFixed(2)} ${polyline} ${x(n - 1).toFixed(2)},${(SVG_H - PAD).toFixed(2)}`;

  const zeroY = y(0);
  const showZero = min < 0 && max > 0;
  const insufficient = n < 2 || values.every((v) => v === 0);

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width={SVG_W}
        height={SVG_H}
        role="img"
        aria-label={ariaLabel}
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
        {points.map((p, i) => (
          <circle key={p.month} cx={x(i)} cy={y(p.value)} r={2} fill={PRIMARY}>
            <title>
              {p.month}: {p.label}
            </title>
          </circle>
        ))}
      </svg>
      {insufficient ? (
        <p className="text-xs text-muted-foreground">Insufficient data for a trend.</p>
      ) : null}
      {n > 0 ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {points[0]!.month} – {points[n - 1]!.month}
        </p>
      ) : null}
    </div>
  );
}
