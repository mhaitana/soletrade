"use server";

import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import {
  ensureSubscription,
  getCreditBalance,
  listCreditLedger,
  priceSubscription,
} from "@/platform/billing";
import type { CreditLedgerRow } from "@/platform/billing";
import { getInstalledModules } from "@/platform/module-installations";
import type { ModuleKey } from "@/shared/constants/modules";
import type { PlanTier } from "@/server/db/schema/enums";
import { env } from "@/shared/lib/env";
import { createProCheckoutSession } from "@/server/stripe/stripe-lifecycle";

export interface BillingOverviewData {
  tier: PlanTier;
  status: string;
  anchorBillingDate: Date | null;
  balanceCents: number;
  currency: string;
  recentLedger: CreditLedgerRow[];
  installedModules: ModuleKey[];
  currentPricing: ReturnType<typeof priceSubscription>;
  canManage: boolean;
}

/**
 * Loader for the read-only /billing overview. View billing is granted to every
 * role (brief §3 — `view:billing`); `manage:billing` (upgrade etc.) is owner/admin
 * and is surfaced as `canManage` for the 4b management UI.
 *
 * Defensively calls `ensureSubscription` first so the page works even when the
 * WorkspaceCreated subscriber hasn't run yet (idempotent — no-op if a row exists).
 */
export async function loadBillingOverview(): Promise<BillingOverviewData> {
  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "view:billing").ok) {
    throw new Error("You don't have permission to view billing.");
  }

  const subscription = await ensureSubscription(ctx.workspaceId);
  const [balanceCents, recentLedger, installedModules] = await Promise.all([
    getCreditBalance(ctx.workspaceId),
    listCreditLedger(ctx.workspaceId, { limit: 10 }),
    getInstalledModules(ctx.workspaceId),
  ]);
  const currentPricing = priceSubscription(subscription.tier, installedModules);

  return {
    tier: subscription.tier,
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

export type CreateUpgradeCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Create a Stripe Checkout Session for upgrading to Pro and return its hosted
 * URL. The browser redirects to it (`window.location.href`) — no client Stripe
 * SDK. `manage:billing` (owner/admin) only. Stripe reconciles the upgrade back
 * to the workspace via the `checkout.session.completed` webhook.
 */
export async function createUpgradeCheckoutAction(): Promise<CreateUpgradeCheckoutResult> {
  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:billing").ok) {
    return { ok: false, error: "You don't have permission to manage billing." };
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  try {
    const { url } = await createProCheckoutSession(ctx.workspaceId, {
      email: ctx.user.email || null,
      successUrl: `${appUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/billing`,
    });
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start checkout." };
  }
}
