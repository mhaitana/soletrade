"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import {
  ensureSubscription,
  getCreditBalance,
  listCreditLedger,
  priceSubscription,
  cancelSubscription,
  switchBillingInterval,
  getCancellationOptions,
  type CancellationPreview,
  BillingNotStartedError,
} from "@/platform/billing";
import type { CreditLedgerRow } from "@/platform/billing";
import { getInstalledModules } from "@/platform/module-installations";
import { getSubscription } from "@/platform/billing/subscriptions";
import { MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";
import type { BillingInterval } from "@/server/db/schema/enums";
import { env } from "@/shared/lib/env";
import { createCheckoutSession } from "@/server/stripe/stripe-lifecycle";
import { moduleRefundCents } from "@/platform/billing/pricing";

export interface BillingOverviewData {
  /** null = billing not started yet (no Stripe subscription on the row). */
  billingInterval: BillingInterval | null;
  /** true when a Stripe subscription exists and the row is active. */
  hasActiveBilling: boolean;
  status: string;
  anchorBillingDate: Date | null;
  balanceCents: number;
  currency: string;
  recentLedger: CreditLedgerRow[];
  installedModules: ModuleKey[];
  /** Breakdown at the workspace's current interval (monthly default for display when not started). */
  currentPricing: ReturnType<typeof priceSubscription>;
  canManage: boolean;
}

/**
 * Loader for the read-only /billing overview. View billing is granted to every
 * role (brief §3 — `view:billing`); `manage:billing` (start billing / manage modules)
 * is owner/admin and is surfaced as `canManage` for the management UI.
 *
 * Defensively calls `ensureSubscription` first so the page works even when the
 * WorkspaceCreated subscriber hasn't run yet (idempotent — no-op if a row exists).
 *
 * The pricing engine is pure, so the breakdown is computed at the workspace's
 * interval (monthly as the display default when billing hasn't started — the page
 * shows the start-billing card instead of the breakdown in that case).
 */
export async function loadBillingOverview(): Promise<BillingOverviewData> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "view:billing")).ok) {
    throw new Error("You don't have permission to view billing.");
  }

  const subscription = await ensureSubscription(ctx.workspaceId);
  const [balanceCents, recentLedger, installedModules] = await Promise.all([
    getCreditBalance(ctx.workspaceId),
    listCreditLedger(ctx.workspaceId, { limit: 10 }),
    getInstalledModules(ctx.workspaceId),
  ]);
  const displayInterval: BillingInterval = subscription.billingInterval ?? "monthly";
  const currentPricing = priceSubscription(installedModules, displayInterval);
  const hasActiveBilling =
    subscription.stripeSubscriptionId != null && subscription.status === "active";

  return {
    billingInterval: subscription.billingInterval,
    hasActiveBilling,
    status: subscription.status,
    anchorBillingDate: subscription.anchorBillingDate,
    balanceCents,
    currency: currentPricing.currency,
    recentLedger,
    installedModules,
    currentPricing,
    canManage: authorize(ctx.role, "manage:billing").ok,
  };
}

const startBillingInputSchema = z.object({
  moduleKeys: z.array(z.enum(MODULE_KEYS)).min(1, "Select at least one module."),
  interval: z.enum(["monthly", "annual"]),
});

export type StartBillingCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Start billing: create a Stripe Checkout Session for a chosen set of modules + an
 * interval and return its hosted URL. The browser redirects to it
 * (`window.location.href`) — no client Stripe SDK. `manage:billing` (owner/admin)
 * only. The highest-standalone-price module becomes the anchor (charged standalone);
 * the rest are add-ons. Stripe reconciles the subscription back to the workspace via
 * the `checkout.session.completed` webhook, which enables each chosen module locally.
 */
export async function startBillingCheckoutAction(
  input: unknown,
): Promise<StartBillingCheckoutResult> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:billing")).ok) {
    return { ok: false, error: "You don't have permission to manage billing." };
  }
  const parsed = startBillingInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  try {
    const { url } = await createCheckoutSession(ctx.workspaceId, {
      moduleKeys: parsed.data.moduleKeys,
      interval: parsed.data.interval,
      email: ctx.user.email || null,
      successUrl: `${appUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/billing`,
    });
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start checkout." };
  }
}

export type CancelSubscriptionResult = { ok: true } | { ok: false; error: string };

const cancelSubscriptionOptionSchema = z.enum(["keep_until_end", "immediate_refund"]);

export type CancelSubscriptionPreviewResult =
  (CancellationPreview & { ok: true }) | { ok: false; error: string };

/**
 * Preview the cancel-all options (brief §10.6 Branch B offboarding). Returns the branch
 * (always offboarding for cancel-all), the period end, and the two options
 * (keep-until-end / immediate-refund) with the summed pro-rated refund amount. Gated
 * `manage:billing`.
 */
export async function previewCancelSubscriptionAction(): Promise<CancelSubscriptionPreviewResult> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:billing")).ok) {
    return { ok: false, error: "You don't have permission to manage billing." };
  }
  const sub = await getSubscription(ctx.workspaceId);
  if (!sub || !sub.stripeSubscriptionId || sub.status !== "active") {
    return { ok: false, error: "Billing has not started." };
  }
  const active = await getInstalledModules(ctx.workspaceId);
  const options = getCancellationOptions({
    activeModules: active,
    moduleKey: undefined, // cancel-all
    interval: sub.billingInterval,
    anchorBillingDate: sub.anchorBillingDate,
    now: new Date(),
  });
  return { ok: true, ...options };
}

/**
 * Cancel the workspace's subscription (user-initiated, Branch B offboarding). `manage:billing`
 * only. Two options (brief §10.6):
 *   - `keep_until_end` → `stripe.subscriptions.update(cancel_at_period_end: true)`; access
 *     continues to period end; the `customer.subscription.deleted` webhook fires then
 *     with no refunds.
 *   - `immediate_refund` → refund the summed pro-rated amount to the card, then cancel
 *     immediately with `metadata.cancelOption = "immediate_refund"`; the webhook issues
 *     no ledger refund.
 *
 * Returns ok after the Stripe call — the immediate cancel completes asynchronously via
 * webhook. The /billing page may briefly show "active" until the webhook lands.
 */
export async function cancelSubscriptionAction(input: unknown): Promise<CancelSubscriptionResult> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:billing")).ok) {
    return { ok: false, error: "You don't have permission to manage billing." };
  }
  const parsed = cancelSubscriptionOptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid cancellation option." };
  }
  try {
    const sub = await getSubscription(ctx.workspaceId);
    if (!sub || !sub.billingInterval || !sub.anchorBillingDate) {
      return { ok: false, error: "Billing has not started." };
    }
    const active = await getInstalledModules(ctx.workspaceId);
    const refundCents = active.reduce(
      (sum, key) =>
        sum +
        moduleRefundCents(key, active, sub.billingInterval!, sub.anchorBillingDate!, new Date()),
      0,
    );
    await cancelSubscription(ctx.workspaceId, parsed.data, refundCents);
    revalidatePath("/billing");
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingNotStartedError) {
      return { ok: false, error: "Billing has not started." };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to cancel subscription.",
    };
  }
}

const switchIntervalInputSchema = z.enum(["monthly", "annual"]);

export type SwitchIntervalResult =
  { ok: true; interval: BillingInterval } | { ok: false; error: string };

/**
 * Switch the workspace's billing interval (monthly↔annual). `manage:billing` only.
 * Reprices every active subscription item to the new interval with
 * `proration_behavior: "none"` (effective next cycle — no Stripe proration), then flips
 * the local `billingInterval`. The 4c ledger does not true-up the switch; the next
 * `invoice.paid` grants at the new prices. Returns the new interval on success.
 */
export async function switchBillingIntervalAction(input: unknown): Promise<SwitchIntervalResult> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:billing")).ok) {
    return { ok: false, error: "You don't have permission to manage billing." };
  }
  const parsed = switchIntervalInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid interval." };
  }
  try {
    await switchBillingInterval(ctx.workspaceId, parsed.data, ctx.user.id);
    revalidatePath("/billing");
    return { ok: true, interval: parsed.data };
  } catch (err) {
    if (err instanceof BillingNotStartedError) {
      return { ok: false, error: "Billing has not started." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Failed to switch interval." };
  }
}
