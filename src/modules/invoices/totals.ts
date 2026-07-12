/**
 * Re-export shim - the line-item totals math now lives in `@/shared/utils/totals`
 * (extracted in Phase 8 so Invoices + Quotes share a single source of truth). The
 * public names (`computeInvoiceTotals`, `lineItemAmountCents`) are preserved so the
 * invoices service, form, and integration test keep importing from `./totals`
 * unchanged. See `@/shared/utils/totals.ts` for the implementation.
 */
export {
  computeLineItemTotals as computeInvoiceTotals,
  lineItemAmountCents,
} from "@/shared/utils/totals";
