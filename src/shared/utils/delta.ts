/**
 * Period-over-period delta helper (Phase 9). Pure — no `server-only`, no DB — used by the
 * cross-module dashboard's KPI cards to render "+12% vs last month" badges.
 *
 * `percentDelta(current, previous)` returns a tagged result so the UI never has to special-case
 * division-by-zero:
 * - `none`  — both zero (no change, nothing to compare).
 * - `new`   — previous zero, current positive (new this period; no meaningful percentage).
 * - `flat`  — current === previous, both non-zero (0% change).
 * - `up`/`down` — signed percentage, rounded to the nearest whole percent.
 *
 * `formatDelta` turns the result into the accessible badge text per the design spec
 * (`pages/dashboard.md`: "delta vs previous period (arrow + accessible text)"). The caller
 * renders the arrow icon + color separately — the text here is the a11y label + visible string.
 */

export type DeltaKind = "up" | "down" | "flat" | "new" | "none";

export interface Delta {
  /** Signed percentage, rounded to 0dp. `null` for `none` / `new` (no meaningful pct). */
  pct: number | null;
  kind: DeltaKind;
}

export function percentDelta(current: number, previous: number): Delta {
  if (current === 0 && previous === 0) return { pct: null, kind: "none" };
  if (previous === 0) return { pct: null, kind: "new" };
  if (current === previous) return { pct: 0, kind: "flat" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, kind: pct > 0 ? "up" : "down" };
}

/**
 * Format a `Delta` as the badge text. Always includes "vs last month" (the dashboard's default
 * period); the caller can override the period noun by passing `periodNoun` (e.g. "vs last
 * quarter"). Returns "" for `none` (the UI shows "No change" via the `kind` directly when it
 * wants to, but the badge text is empty so a bare zero-state card doesn't show a misleading
 * badge).
 */
export function formatDelta(d: Delta, periodNoun = "last month"): string {
  switch (d.kind) {
    case "up":
      return `+${d.pct}% vs ${periodNoun}`;
    case "down":
      return `${d.pct}% vs ${periodNoun}`;
    case "flat":
      return `No change vs ${periodNoun}`;
    case "new":
      return `New this period`;
    case "none":
      return "";
  }
}
