import { NextResponse } from "next/server";
import { env } from "@/shared/lib/env";
import { isCronAuthorized } from "@/server/cron-auth";
import { runModuleCancelFinalizeJob } from "@/server/jobs/module-cancel-finalize";

/**
 * Cron entrypoint for the module-cancel-finalize job (brief §10.6 Branch A). Protected
 * by the shared `CRON_SECRET` (bearer or `x-cron-secret`). 500 when the secret isn't
 * configured so a misconfigured scheduler surfaces; 401 on a bad secret. `force-dynamic`
 * keeps it out of the static optimizer (it mutates the DB).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron not configured." }, { status: 500 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const finalized = await runModuleCancelFinalizeJob();
  console.log("[cron] module-cancel-finalize job ran", { finalized });
  return NextResponse.json({ ok: true, finalized });
}
