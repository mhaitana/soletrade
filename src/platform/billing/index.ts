/**
 * Billing platform service (brief §4). Re-exports the pricing engine (pure, no
 * `server-only` - safe for client/server components), the credit ledger
 * (append-only), the subscription service, the module orchestrator, and the
 * webhook reconcile functions (all server-only).
 *
 * The public `/pricing` page imports this barrel from a server component, so
 * re-exporting server-only modules here is safe. Client components must import
 * `@/platform/billing/pricing` directly (the only pure module).
 */
export * from "./pricing";
export * from "./credits";
export * from "./subscriptions";
export * from "./modules";
export * from "./reconcile";
// Pure cancellation engine (brief §10.6) - no `server-only`, safe alongside the rest.
export * from "./cancellation";
