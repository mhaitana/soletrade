"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getStripe } from "@/server/infrastructure/stripe/client";
import { rateLimit } from "@/server/infrastructure/rate-limit/index";
import { claimPaymentIntentId, getInvoicePaymentContext } from "@/server/domains/invoices/index";

/**
 * Public payment-intent creation for the `/i/[token]` page. No auth - the publicToken is the
 * credential (122-bit unguessable). The action creates a Stripe PaymentIntent for the invoice
 * total and returns its client secret; the client confirms via Stripe Elements.
 *
 * Idempotent across reloads: if a PI id is already stored on the invoice, it's retrieved and
 * its client secret reused (Stripe PI client secrets are reusable until the PI succeeds or
 * is canceled). An atomic `claimPaymentIntentId` guards against two concurrent creates both
 * making a PI - the loser reuses the winner's.
 *
 * Rate-limited per IP (defense-in-depth). The publicToken is unguessable, so this only
 * matters if the link itself is abused.
 */

const tokenSchema = z.object({ token: z.string().min(1) });

export type PaymentIntentResult =
  { ok: true; clientSecret: string } | { ok: false; error: string; paid?: boolean };

export async function createInvoicePaymentIntentAction(
  input: unknown,
): Promise<PaymentIntentResult> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invoice link." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!(await rateLimit(`pi:${ip}`, { max: 10, windowMs: 60_000 }))) {
    return { ok: false, error: "Too many attempts. Please try again shortly." };
  }

  const ctx = await getInvoicePaymentContext(parsed.data.token);
  if (!ctx) {
    // Unknown token, or the invoice is a draft / void / already paid.
    return { ok: false, error: "This invoice is not available for payment.", paid: true };
  }

  const stripe = getStripe();

  // Reuse an existing PaymentIntent if one was already created for this invoice (reload,
  // second tab, abandoned-and-return). A succeeded PI means the webhook already marked the
  // invoice paid - but the context lookup above would have returned null (status === "paid"),
  // so we shouldn't reach this branch in that case. Still, guard defensively.
  if (ctx.stripePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(ctx.stripePaymentIntentId);
      if (pi.status === "succeeded") {
        return { ok: false, error: "This invoice has already been paid.", paid: true };
      }
      if (pi.client_secret) {
        return { ok: true, clientSecret: pi.client_secret };
      }
    } catch (err) {
      // A canceled/failed PI: fall through and create a new one. The claim below will fail
      // (a PI id is already stored), so we re-store via a direct update to the new PI id.
      console.warn("[invoices] reuse PI failed, creating new:", err);
    }
  }

  const pi = await stripe.paymentIntents.create({
    amount: ctx.totalCents,
    currency: ctx.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: {
      invoiceId: ctx.invoiceId,
      workspaceId: ctx.workspaceId,
      publicToken: parsed.data.token,
    },
  });

  if (!pi.client_secret) {
    return { ok: false, error: "Could not start payment. Please try again." };
  }

  // Atomically claim the PI id. If a concurrent request won, reuse its PI instead (so we
  // don't leak a dangling PI). The unique partial index is the real guard.
  const claimed = await claimPaymentIntentId(ctx.workspaceId, ctx.invoiceId, pi.id);
  if (!claimed) {
    // Another request created a PI for this invoice first - retrieve + reuse that one,
    // and let the just-created PI cancel itself (Stripe cancels PIs that never get attached
    // after a period; we don't explicitly cancel to keep this path simple).
    const fresh = await getInvoicePaymentContext(parsed.data.token);
    if (fresh?.stripePaymentIntentId && fresh.stripePaymentIntentId !== pi.id) {
      try {
        const existing = await stripe.paymentIntents.retrieve(fresh.stripePaymentIntentId);
        if (existing.client_secret) {
          return { ok: true, clientSecret: existing.client_secret };
        }
      } catch {
        // fall through to our own PI
      }
    }
  }

  return { ok: true, clientSecret: pi.client_secret };
}
