import { isCronAuthorized } from "@/server/cron-auth";
import { deliverMobilePush } from "@/platform/mobile/push";
import { purgeClosedAccounts } from "@/platform/mobile/jobs";
import { reconcileStoreContracts } from "@/platform/mobile/store-events";
import { summarizeMobileJobHealth } from "@/platform/mobile/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [push, deletion, billing] = await Promise.all([
    deliverMobilePush(),
    purgeClosedAccounts(),
    process.env.MOBILE_STORE_PURCHASES_ENABLED === "true"
      ? reconcileStoreContracts()
      : Promise.resolve({ refreshed: 0 }),
  ]);
  const health = await summarizeMobileJobHealth();
  return Response.json({ push, deletion, billing, health });
}
