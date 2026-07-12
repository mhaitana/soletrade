import "server-only";
import { markOverdueInvoices } from "@/modules/invoices";

/**
 * Overdue invoice job runner (Phase 5b). Pure runner - no HTTP - so it's unit-testable
 * directly and reusable from a CLI script later. The cron route
 * (`/api/cron/invoice-overdue`) calls this after verifying the CRON_SECRET.
 *
 * Flips all `sent`/`viewed` invoices whose `due_date < now` to `overdue`, publishing an
 * `InvoiceOverdue` activity event per invoice. No email in 5b (deferred to the notifications
 * module). Returns the count flipped so the cron route can log/return it.
 */
export async function runOverdueJob(now: Date = new Date()): Promise<number> {
  return markOverdueInvoices(now);
}
