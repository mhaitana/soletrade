import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/server/infrastructure/config/env";
import { isCronAuthorized } from "@/server/application/jobs/cron-auth";
import { runOverdueJob } from "@/server/application/jobs/overdue";

/**
 * Cron entrypoint for the overdue invoice job (Phase 5b). Protected by a shared bearer
 * secret (`CRON_SECRET`): Vercel Cron / an external scheduler sends it as
 * `Authorization: Bearer <secret>` (or `x-cron-secret`). 401 on a missing/mismatched
 * secret so a misconfigured scheduler surfaces, rather than a 500 that retries silently.
 * The check is the shared `isCronAuthorized`; this file used to carry its own copy of the
 * comparison, which accepted any value whose length differed from the secret's.
 *
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

  const marked = await runOverdueJob();
  console.log("[cron] invoice-overdue job ran", { marked });
  return NextResponse.json({ ok: true, marked });
}
