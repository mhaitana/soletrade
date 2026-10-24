import "server-only";
import { mobileHealthReportSchema } from "@soletrade/contracts";
import { rateLimit } from "@/server/rate-limit";
import type { UserId } from "@/shared/types/ids";
import { MobileApiError } from "./http";
import { getDataClient } from "@/server/db/client";

export async function recordMobileHealth(userId: UserId, body: unknown) {
  const report = mobileHealthReportSchema.parse(body);
  if (!(await rateLimit(`mobile-health:${userId}`, { max: 10, windowMs: 60_000 })))
    throw new MobileApiError("RATE_LIMITED", "Device health reporting will retry later.", 429);
  // eventId permits deduplication of a lost acknowledgement in the log collector.
  // The strict contract excludes identity, coordinates, record IDs and free text.
  for (const event of report.events) console.warn("Mobile device health", event);
  return { accepted: true };
}

export async function summarizeMobileJobHealth() {
  const db = getDataClient();
  const results = await Promise.all([
    db
      .from("mobile_notification_outbox")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "uncertain"]),
    db
      .from("mobile_push_deliveries")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "uncertain"]),
    db.from("billing_events").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db
      .from("mobile_api_operations")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      // Stream turns deliberately retain their claim to prohibit replay. Their
      // individual write tools use separate normal operation claims.
      .not("operation", "like", "%/assistant/%")
      .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString()),
    db
      .from("account_deletion_requests")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("purge_after", new Date().toISOString()),
  ]);
  if (results.some((result) => result.error)) throw new Error("Unable to read mobile job health");
  const health = {
    pushJobsNeedingAttention: results[0]!.count ?? 0,
    pushDevicesNeedingAttention: results[1]!.count ?? 0,
    failedBillingEvents: results[2]!.count ?? 0,
    uncertainOperations: results[3]!.count ?? 0,
    overdueAccountPurges: results[4]!.count ?? 0,
  };
  if (Object.values(health).some((count) => count > 0)) console.warn("Mobile job health", health);
  return health;
}
