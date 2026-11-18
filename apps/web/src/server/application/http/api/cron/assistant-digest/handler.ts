import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/server/infrastructure/config/env";
import { isCronAuthorized } from "@/server/application/jobs/cron-auth";
import { runAssistantDigestJob } from "@/server/application/jobs/assistant-digest";

/**
 * Cron entrypoint for the briefing digest job. Protected by the shared `CRON_SECRET`
 * (bearer or `x-cron-secret`). 500 when the secret isn't configured so a misconfigured
 * scheduler surfaces; 401 on a bad secret. `force-dynamic` keeps it out of the static
 * optimizer (it mutates the DB). It runs hourly because each workspace's 07:00 falls in a
 * different hour; a run that finds nobody due makes one database call.
 */

export async function GET(request: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron not configured." }, { status: 500 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await runAssistantDigestJob();
  console.log("[cron] assistant-digest job ran", result);
  return NextResponse.json({ ok: true, ...result });
}
