import "server-only";
import { markExpiredQuotes } from "@/modules/quotes";

/**
 * Quote-expiry job runner (Phase 8). Pure runner — no HTTP — so it's unit-testable
 * directly and reusable from a CLI script later. The cron route
 * (`/api/cron/quote-expired`) calls this after verifying the CRON_SECRET.
 *
 * Flips all `sent`/`viewed` quotes whose `valid_until < now` to `expired`, publishing a
 * `QuoteExpired` activity event per quote (no email — activity-feed only). Accepted quotes
 * don't expire (they're heading to conversion). Returns the count flipped so the cron
 * route can log/return it.
 */
export async function runQuoteExpiredJob(now: Date = new Date()): Promise<number> {
  return markExpiredQuotes(now);
}
