import "server-only";
import { finalizeModuleCancellations } from "@/platform/billing/modules";

/**
 * Module-cancel-finalize job runner (brief §10.6 Branch A "keep-until-end"). Pure
 * runner — no HTTP — so it's unit-testable directly and reusable from a CLI script.
 * The cron route (`/api/cron/module-cancel-finalize`) calls this after verifying the
 * CRON_SECRET.
 *
 * Finalizes module installation rows whose `pendingCancellationAt` has lapsed: deletes
 * the Stripe subscription item, disables the local row. Idempotent (the row flips to
 * cancelled). Returns the count finalized.
 */
export async function runModuleCancelFinalizeJob(now: Date = new Date()): Promise<number> {
  return finalizeModuleCancellations(now);
}
