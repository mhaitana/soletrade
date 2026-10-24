# Product domains

Books, Drive, Invoices and Quotes own their backend operations and document definitions.
Each domain can depend on foundation services, infrastructure, and browser-safe contracts.
Do not import sibling domains or application/UI code.

Use `server/application` for cross-product orchestration such as quote conversion, webhooks,
assistant tools, and native API aggregation. Preserve database transactions and triggers for
financial source-to-ledger updates; the process-local event bus handles non-transactional effects.

Client-safe DTOs, calculation functions, and schemas live in `src/lib/domain/<domain>` and
remain independent of this server tree.
