import "server-only";
import { markExpiredCredits } from "@/platform/billing/credits";

/**
 * Credit-expiry job runner (brief §10.7). Pure runner — no HTTP — so it's
 * unit-testable directly and reusable from a CLI script. The cron route
 * (`/api/cron/credit-expired`) calls this after verifying the CRON_SECRET.
 *
 * Reverses grant/promotion ledger rows whose `expiresAt` has passed by appending
 * a negative `expired` row (idempotent — one expired row per original). The
 * derived balance drops automatically. Returns the count of newly-expired rows.
 */
export async function runCreditExpiredJob(now: Date = new Date()): Promise<number> {
  return markExpiredCredits(now);
}
