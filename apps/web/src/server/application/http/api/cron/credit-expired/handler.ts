import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/server/infrastructure/config/env";
import { isCronAuthorized } from "@/server/application/jobs/cron-auth";
import { runCreditExpiredJob } from "@/server/application/jobs/credit-expired";

/**
 * Cron entrypoint for the credit-expiry job (brief §10.7). Protected by the
 * shared `CRON_SECRET` (bearer or `x-cron-secret`). 500 when the secret isn't
 * configured so a misconfigured scheduler surfaces; 401 on a bad secret.
 * `force-dynamic` keeps it out of the static optimizer (it mutates the DB).
 */

export async function GET(request: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron not configured." }, { status: 500 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const marked = await runCreditExpiredJob();
  console.log("[cron] credit-expired job ran", { marked });
  return NextResponse.json({ ok: true, marked });
}
