"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { acceptQuote, declineQuote, type AcceptanceMeta, type DeclineMeta } from "@/modules/quotes";

/**
 * Public accept/decline actions for the `/q/[token]` page. No auth — the publicToken is the
 * credential (122-bit unguessable). Rate-limited per IP (defense-in-depth) mirroring the
 * invoice payment-intent action. Returns `{ ok: true }` on success or `{ ok: false, error }`.
 *
 * Wave 2: accept captures the accepter's name + optional signature (typed name or canvas
 * data-URL) + the request IP/UA, threaded into `acceptQuote` which writes a `quote_acceptances`
 * row. Decline captures IP/UA (no name needed — declines aren't legally significant).
 */

const acceptSchema = z.object({
  token: z.string().min(1),
  accepterName: z.string().trim().min(1, "Please enter your name.").max(200),
  accepterEmail: z.string().trim().max(200).optional(),
  signature: z.string().max(100_000).optional(),
});

const declineSchema = z.object({
  token: z.string().min(1),
  reason: z.string().trim().max(2000).optional(),
});

export type QuoteAcceptResult = { ok: true } | { ok: false; error: string };

/** Extract IP + User-Agent from the request headers (defensive — "unknown" if absent). */
async function readRequestMeta(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const userAgent = h.get("user-agent") || "unknown";
  return { ip, userAgent };
}

export async function acceptQuoteAction(input: unknown): Promise<QuoteAcceptResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields." };
  }

  const { ip, userAgent } = await readRequestMeta();
  if (!(await rateLimit(`quote:${ip}`, { max: 10, windowMs: 60_000 }))) {
    return { ok: false, error: "Too many attempts. Please try again shortly." };
  }

  const meta: AcceptanceMeta = {
    accepterName: parsed.data.accepterName,
    accepterEmail: parsed.data.accepterEmail || null,
    signature: parsed.data.signature || null,
    ipAddress: ip,
    userAgent,
  };

  try {
    const ok = await acceptQuote(parsed.data.token, meta);
    if (!ok) return { ok: false, error: "This quote can no longer be accepted." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to accept quote." };
  }
}

export async function declineQuoteAction(input: unknown): Promise<QuoteAcceptResult> {
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quote link." };

  const { ip, userAgent } = await readRequestMeta();
  if (!(await rateLimit(`quote:${ip}`, { max: 10, windowMs: 60_000 }))) {
    return { ok: false, error: "Too many attempts. Please try again shortly." };
  }

  const meta: DeclineMeta = {
    ipAddress: ip,
    userAgent,
    reason: parsed.data.reason || null,
  };

  const ok = await declineQuote(parsed.data.token, meta);
  if (!ok) {
    return { ok: false, error: "This quote can no longer be declined." };
  }
  return { ok: true };
}
