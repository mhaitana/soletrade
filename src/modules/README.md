# modules/

Business product logic. Each module is independently enable/disable per workspace via
`module_installations`, but consumes shared `platform/*` services.

## Boundary rules (enforced)

- MAY import from `platform/*` and `shared/*`.
- MUST NOT import from another module directly - cross-module side effects go through the
  internal event bus (`server/events`), e.g. `InvoicePaid` → Books income transaction.
- MUST NOT be imported by `platform/*` or `shared/*`.

## Modules

| Folder     | Purpose                                  | Phase   |
| ---------- | ---------------------------------------- | ------- |
| `invoices` | Billing, Stripe payment, reminders       | Phase 5 |
| `books`    | Cash-book ledger, receipt OCR pipeline   | Phase 6 |
| `drive`    | Gig earnings + mileage tracking          | Phase 7 |
| `quotes`   | Proposals, acceptance, convert-to-invoice | Phase 8 |