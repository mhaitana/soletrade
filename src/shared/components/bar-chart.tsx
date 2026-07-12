/**
 * Shared inline-SVG categorical bar chart (Wave 2 - Drive platform-earnings chart + GST-by-
 * quarter). Mirrors `<Sparkline>`: pure SVG, server-rendered, no client JS, no `"use client"`,
 * no new charting dependency. Each bar carries a native `<title>` tooltip (`{label}: {value}`).
 *
 * Boundary-clean: **shared imports nothing app-specific** (no `@/platform/*`, no `@/modules/*`)
 * - the caller pre-formats the per-bar tooltip `valueLabel` (e.g. via `formatCents`). This
 * component just renders the bars it's given; it does no aggregation.
 *
 * Degenerate cases (no bars, or all bars zero) render an "Insufficient data" caption rather
 * than a misleading chart. Bars are scaled to the max value; non-negative series assumed
 * (categorical earnings / GST counts - negative values would render below the baseline).
 */

export interface BarChartPoint {
  /** Stable key for React (e.g. slug). */
  key: string;
  /** Short x-axis caption shown under the bar (e.g. "Uber" or "Q1"). */
  label: string;
  /** The numeric value to plot (expected non-negative; clamped to 0 for negatives). */
  value: number;
  /** Pre-formatted tooltip text for this bar, e.g. "$1,234.56" or "12 trips". */
  valueLabel: string;
}

export interface BarChartProps {
  points: readonly BarChartPoint[];
  /** Accessible label for the `<svg role="img">`, e.g. "Earnings by platform". */
  ariaLabel: string;
}

const SVG_W = 240;
const SVG_H = 90;
const PAD_TOP = 4;
const PAD_BOTTOM = 18; // room for x-axis caption
const PAD_X = 4;
// Read from the theme token so bars adapt in dark mode (chart-2 is #2563eb in light,
// #60a5fa in dark - a hardcoded #2563EB is too-dark blue on the dark background).
const PRIMARY = "var(--chart-2)";

export function BarChart({ points, ariaLabel }: BarChartProps) {
  const n = points.length;
  const max = Math.max(...points.map((p) => Math.max(0, p.value)), 0);
  const insufficient = n === 0 || max === 0;

  const plotH = SVG_H - PAD_TOP - PAD_BOTTOM;
  const slotW = n > 0 ? (SVG_W - 2 * PAD_X) / n : 0;
  const barW = Math.min(slotW * 0.7, 36);
  const barH = (v: number) => (max > 0 ? (Math.max(0, v) / max) * plotH : 0);

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
        {insufficient ? null : (
          <line
            x1={PAD_X}
            y1={PAD_TOP + plotH}
            x2={SVG_W - PAD_X}
            y2={PAD_TOP + plotH}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        )}
        {points.map((p, i) => {
          const cx = PAD_X + slotW * i + slotW / 2;
          const h = barH(p.value);
          const y = PAD_TOP + plotH - h;
          const labelY = PAD_TOP + plotH + 12;
          return (
            <g key={p.key}>
              <rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={Math.max(h, 0.5)}
                fill={PRIMARY}
                fillOpacity={0.85}
                rx={1}
              >
                <title>
                  {p.label}: {p.valueLabel}
                </title>
              </rect>
              <text
                x={cx}
                y={labelY}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.7}
                className="tabular-nums"
              >
                {p.label.length > 8 ? `${p.label.slice(0, 7)}…` : p.label}
              </text>
            </g>
          );
        })}
      </svg>
      {insufficient ? (
        <p className="text-xs text-muted-foreground">Insufficient data for a chart.</p>
      ) : null}
    </div>
  );
}
