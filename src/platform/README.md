# platform/

Reusable platform services shared across all product modules.

## Boundary rules (enforced)

- Modules MAY import from `platform/*` and `shared/*`.
- `platform/*` MUST NOT import from `modules/*` (modules depend on platform, never the reverse).
- `platform/*` MAY import from `shared/*` and `server/*`.
- Never trust a client-provided `workspaceId` — resolve it server-side from the session.

## Services (added per phase)

| Folder      | Purpose                                            | Phase   |
| ----------- | -------------------------------------------------- | ------- |
| `auth`      | Session, sign-in/up, server-side user resolution    | Phase 1 |
| `workspaces`| Workspace CRUD, switcher, current workspace resolver | Phase 1 |
| `members`   | Membership, invitations, roles                     | Phase 1 |
| `permissions`| Role + permission helpers (`can(...)`)           | Phase 1 |
| `customers` | Shared customers CRUD (used by Quotes/Invoices/Books) | Phase 2 |
| `files`     | Upload, signed URLs, metadata                      | Phase 2 |
| `activity`  | Activity event write + feed                        | Phase 1 |
| `audit`     | Audit log write                                    | Phase 1 |
| `notifications` | Email/SMS service + preferences               | Phase 11|
| `billing`   | Stripe customer/subscription, pricing engine, credit ledger | Phase 3–4 |
| `ai`        | Provider abstraction + tools                       | Phase 10|
| `search`    | Global search                                      | Phase 2 |
| `settings`  | Workspace settings                                 | Phase 1 |