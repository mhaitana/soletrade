-- 0019_feed_audit_indexes.sql
-- Review 2026-07: the two highest-traffic read-side tables had zero indexes (only their PK),
-- so every activity-feed / audit / customer-timeline query seq-scanned + sorted on tables that
-- grow monotonically with every event. This adds the composite indexes the keyset-cursor
-- list queries (`listActivity`, `listAudit`, customer timeline) filter + order on.
--
-- Also closes two LOW index gaps surfaced in the same review:
--  - `driver_vehicle_expenses.notes` was the only ILIKE-search column without a trigram
--    index (migration 0017 indexed its `description` but not `notes`; `listExpenses`
--    searches both). Mirrors the 0017 gin pattern.
--  - `customers` list orders by `created_at DESC` and filters `deleted_at IS NULL`; a
--    partial index covers that exact path.
--
-- Hand-authored (not drizzle-kit generated), matching the 0017 convention: DB-level only,
-- Drizzle schema unchanged, so `db:generate` still diffs against the unchanged snapshot
-- (0019_snapshot.json is a copy of 0018's — no schema drift). `pg_trgm` was already created
-- in 0017 with `IF NOT EXISTS`, so the gin index below is safe regardless of apply order.

-- Activity feed: main list query filters `workspace_id` + keyset-paginates on
-- `(created_at DESC, id DESC)`.
CREATE INDEX IF NOT EXISTS "activity_events_workspace_created_idx"
  ON "activity_events" ("workspace_id", "created_at" DESC, "id" DESC);--> statement-breakpoint

-- Activity feed: entity-filtered path (customer timeline filters `entity_type='customer'`
-- + `entity_id`). Lets the timeline skip the workspace-wide sort.
CREATE INDEX IF NOT EXISTS "activity_events_workspace_entity_idx"
  ON "activity_events" ("workspace_id", "entity_type", "entity_id", "created_at" DESC);--> statement-breakpoint

-- Audit log: `/audit` filters `workspace_id` + keyset-paginates on `(created_at DESC, id DESC)`.
CREATE INDEX IF NOT EXISTS "audit_logs_workspace_created_idx"
  ON "audit_logs" ("workspace_id", "created_at" DESC, "id" DESC);--> statement-breakpoint

-- Drive vehicle expenses: trigram index for `listExpenses` ILIKE on `notes`
-- (the one search column missing backing in migration 0017).
CREATE INDEX IF NOT EXISTS "driver_vehicle_expenses_notes_trgm"
  ON "driver_vehicle_expenses" USING gin ("notes" gin_trgm_ops);--> statement-breakpoint

-- Customers: list orders by `created_at DESC` and filters out soft-deleted rows.
-- A partial index covering the live rows avoids sorting the filtered set.
CREATE INDEX IF NOT EXISTS "customers_workspace_created_live_idx"
  ON "customers" ("workspace_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint