import { NextResponse } from "next/server";
import { env } from "@/shared/lib/env";
import { runQuoteExpiredJob } from "@/server/jobs/quote-expired";

/**
 * Cron entrypoint for the quote-expiry job (Phase 8). Protected by a shared bearer
 * secret (`CRON_SECRET`): Vercel Cron / an external scheduler sends it as
 * `Authorization: Bearer <secret>` (or `x-cron-secret`). 401 on a missing/mismatched
 * secret so a misconfigured scheduler surfaces, rather than a 500 that retries silently.
 *
 * `force-dynamic` keeps it out of the static optimizer (it mutates the DB).
 */
export const dynamic = "force-dynamic";

/** Constant-time string compare to avoid leaking the secret length via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // still do the comparison to keep timing roughly constant
    b = a;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0 && a.length === b.length && a.length > 0;
}

export async function GET(request: Request): Promise<Response> {
  const secret = env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const headerSecret = request.headers.get("x-cron-secret");
  const provided = bearer ?? headerSecret;
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const marked = await runQuoteExpiredJob();
  console.log("[cron] quote-expired job ran", { marked });
  return NextResponse.json({ ok: true, marked });
}
