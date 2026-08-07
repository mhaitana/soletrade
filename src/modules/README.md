# modules/

Business product logic. Each module is independently enable/disable per workspace via
`module_installations`, but consumes shared `platform/*` services.

## Boundary rules (enforced)

- MAY import from `platform/*` and `shared/*`.
- MUST NOT import from another module directly. Non-transactional cross-module side effects go
  through the internal event bus (`server/events`). Financial source→Books mirrors are enforced
  transactionally by the database sync triggers so a source write cannot commit without its
  ledger update.
- MUST NOT be imported by `platform/*` or `shared/*`.

## Modules

| Folder     | Purpose                                  | Phase   |
| ---------- | ---------------------------------------- | ------- |
| `invoices` | Billing, Stripe payment, reminders       | Phase 5 |
| `books`    | Cash-book ledger, receipt OCR pipeline   | Phase 6 |
| `drive`    | Gig earnings + mileage tracking          | Phase 7 |
| `quotes`   | Proposals, acceptance, convert-to-invoice | Phase 8 |
