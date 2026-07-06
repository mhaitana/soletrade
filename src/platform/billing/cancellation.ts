import { moduleRefundCents, type Interval } from "@/platform/billing/pricing";
import type { ModuleKey } from "@/shared/constants/modules";

/**
 * Cancellation engine (brief §10.6). Pure: no `server-only`, no DB, no Stripe —
 * safe to unit-test and import from server actions. Decides *which* cancellation
 * options a workspace is offered and what each option costs, given the workspace's
 * active module set and billing state. The execution path (`modules.ts`) consumes
 * the chosen option and performs the side effects (Stripe / ledger / row update).
 *
 * Two branches (brief §10.6):
 *   - **Branch A — continuous**: removing a module while ≥1 other module stays
 *     active. Three options: keep-until-end-of-cycle (no charge, access runs to
 *     period end), immediate platform credit (pro-rated refund to the credit
 *     ledger), immediate card refund (pro-rated refund to the original payment
 *     method). The credit option is the recommended default.
 *   - **Branch B — offboarding**: the removal leaves zero active modules — either
 *     because the last active module is being removed, or the whole subscription
 *     is being cancelled (`moduleKey` undefined = cancel-all). Two options:
 *     keep-until-end-of-cycle, immediate card refund. **No platform credit** — the
 *     workspace is leaving, so credit is useless to them.
 *
 * When there is no active billing (null interval / null anchor), only the
 * keep option is offered (= just disable the module locally; amount 0). This is
 * the legacy/unbilled fallback.
 */

export type CancelOption = "keep_until_end_of_cycle" | "immediate_credit" | "immediate_refund";

export interface CancelOptionQuote {
  option: CancelOption;
  /** Cents moved by this option: 0 for keep, the pro-rated refund for credit/refund. */
  amountCents: number;
  /** Whether the UI should pre-select / recommend this option. */
  recommended: boolean;
}

export interface CancellationPreview {
  /** "continuous" (Branch A) or "offboarding" (Branch B). */
  branch: "continuous" | "offboarding";
  /** End of the current billing period (null when no active billing). */
  periodEnd: Date | null;
  /** The options the user may choose between, in display order. */
  options: CancelOptionQuote[];
}

export interface CancellationInput {
  /** Active modules BEFORE the cancellation. */
  activeModules: readonly ModuleKey[];
  /**
   * The module being removed. `undefined` = cancel the whole subscription
   * (cancel-all path → always offboarding).
   */
  moduleKey?: ModuleKey;
  interval: Interval | null;
  anchorBillingDate: Date | null;
  now: Date;
}

/**
 * Resolve the billing period end for the current cycle. Null when there's no
 * active billing. Mirrors `currentBillingPeriod`'s math (30d monthly / 365d annual).
 */
function resolvePeriodEnd(
  interval: Interval | null,
  anchorBillingDate: Date | null,
  now: Date,
): Date | null {
  if (!interval || !anchorBillingDate) return null;
  const periodMs = interval === "annual" ? 365 * 86_400_000 : 30 * 86_400_000;
  const anchorMs = anchorBillingDate.getTime();
  const periodsSinceAnchor = Math.floor((now.getTime() - anchorMs) / periodMs);
  return new Date(anchorMs + (periodsSinceAnchor + 1) * periodMs);
}

/**
 * Compute the cancellation options for a workspace per spec §10.6. See the module
 * docstring for the branch logic. `amountCents` for the credit/refund options is
 * the pro-rated refund (`moduleRefundCents`) — for cancel-all it's the sum over all
 * active modules; for a single module it's that module's refund.
 */
export function getCancellationOptions(input: CancellationInput): CancellationPreview {
  const { activeModules, moduleKey, interval, anchorBillingDate, now } = input;
  const periodEnd = resolvePeriodEnd(interval, anchorBillingDate, now);

  // Offboarding iff the removal leaves zero active modules. Cancel-all (no
  // moduleKey) is always offboarding. Single-module removal is offboarding iff it
  // is the only active module.
  const leavesZero = moduleKey === undefined || activeModules.length <= 1;
  const branch: "continuous" | "offboarding" = leavesZero ? "offboarding" : "continuous";

  // No active billing → only the keep option (= just disable locally, amount 0).
  if (!interval || !anchorBillingDate) {
    return {
      branch,
      periodEnd: null,
      options: [{ option: "keep_until_end_of_cycle", amountCents: 0, recommended: true }],
    };
  }

  // Pro-rated refund amount for the chosen scope.
  const refundAmount =
    moduleKey === undefined
      ? activeModules.reduce(
          (sum, key) =>
            sum + moduleRefundCents(key, activeModules, interval, anchorBillingDate, now),
          0,
        )
      : moduleRefundCents(moduleKey, activeModules, interval, anchorBillingDate, now);

  if (branch === "continuous") {
    // Branch A: keep (recommended default = credit), credit, refund.
    return {
      branch: "continuous",
      periodEnd,
      options: [
        { option: "keep_until_end_of_cycle", amountCents: 0, recommended: false },
        { option: "immediate_credit", amountCents: refundAmount, recommended: true },
        { option: "immediate_refund", amountCents: refundAmount, recommended: false },
      ],
    };
  }

  // Branch B: keep, refund. NO credit (offboarding — credit is useless).
  return {
    branch: "offboarding",
    periodEnd,
    options: [
      { option: "keep_until_end_of_cycle", amountCents: 0, recommended: false },
      { option: "immediate_refund", amountCents: refundAmount, recommended: true },
    ],
  };
}
