import "server-only";
import { isCronAuthorized } from "@/server/application/jobs/cron-auth";
import { deliverMobilePush } from "@/server/application/mobile/push";
import { pruneMobileOperations, purgeClosedAccounts } from "@/server/application/mobile/jobs";
import { reconcileStoreContracts } from "@/server/application/mobile/store-events";
import { summarizeMobileJobHealth } from "@/server/application/mobile/health";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [push, deletion, billing, prunedOperations] = await Promise.all([
    deliverMobilePush(),
    purgeClosedAccounts(),
    process.env.MOBILE_STORE_PURCHASES_ENABLED === "true"
      ? reconcileStoreContracts()
      : Promise.resolve({ refreshed: 0 }),
    // Housekeeping must never fail the delivery work above.
    pruneMobileOperations().catch((error: unknown) => {
      console.error("[cron] mobile operation pruning failed", error);
      return 0;
    }),
  ]);
  const health = await summarizeMobileJobHealth();
  return Response.json({ push, deletion, billing, prunedOperations, health });
}
