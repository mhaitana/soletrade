"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { acceptQuote, declineQuote } from "@/modules/quotes";

/**
 * Public accept/decline actions for the `/q/[token]` page. No auth — the publicToken is the
 * credential (122-bit unguessable). Rate-limited per IP (defense-in-depth) mirroring the
 * invoice payment-intent action. Returns `{ ok: true }` on success or `{ ok: false, error }`.
 */

const tokenSchema = z.object({ token: z.string().min(1) });

export type QuoteAcceptResult = { ok: true } | { ok: false; error: string };

export async function acceptQuoteAction(input: unknown): Promise<QuoteAcceptResult> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quote link." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!rateLimit(`quote:${ip}`, { max: 10, windowMs: 60_000 })) {
    return { ok: false, error: "Too many attempts. Please try again shortly." };
  }

  const ok = await acceptQuote(parsed.data.token);
  if (!ok) {
    return { ok: false, error: "This quote can no longer be accepted." };
  }
  return { ok: true };
}

export async function declineQuoteAction(input: unknown): Promise<QuoteAcceptResult> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quote link." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!rateLimit(`quote:${ip}`, { max: 10, windowMs: 60_000 })) {
    return { ok: false, error: "Too many attempts. Please try again shortly." };
  }

  const ok = await declineQuote(parsed.data.token);
  if (!ok) {
    return { ok: false, error: "This quote can no longer be declined." };
  }
  return { ok: true };
}
