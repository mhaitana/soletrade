# server/

Server-only infrastructure: database, third-party clients, jobs, events, caching, security.
Never imported from client code (these modules should pull `import "server-only"` at boundaries).

## Folders

| Folder   | Purpose                                                | Phase   |
| -------- | ------------------------------------------------------ | ------- |
| `db`     | Drizzle client + schema, migrations                    | Phase 1 |
| `stripe` | Stripe SDK client + webhook helpers                    | Phase 3 |
| `jobs`   | Background job runner (Trigger.dev / Inngest / simple) | Phase 5+|
| `events` | Internal typed event bus (in-process, queue-ready)    | Phase 1 |
| `cache`  | Redis client + rate limiting                           | Phase 3+|
| `security`| Rate limiters, signature verification, IDOR guards   | Phase 12|

## Boundary rules

- MAY import from `shared/*` only (no `platform/*` or `modules/*`).
- All exports are server-only.