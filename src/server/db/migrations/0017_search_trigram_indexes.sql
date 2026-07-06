-- 0017_search_trigram_indexes.sql
-- Wave 3: index-backed leading-wildcard ILIKE (%term%) for global search + every list-page
-- search box. `pg_trgm` trigram indexes are the only Postgres index type that supports
-- leading-wildcard ILIKE; a plain btree can't. The query planner combines the `workspaceId`
-- btree filter (already present in every list query) with these gin indexes via bitmap AND,
-- so a search stays fast as the tables grow.
--
-- Hand-authored (not drizzle-kit generated): Drizzle doesn't manage extensions, and a pure-SQL
-- extension + index migration is cleaner than forcing the schema to declare 12 gin indexes
-- that exist only as a search-infrastructure optimization (not part of the app's data model).
-- The indexes are DB-level only; the Drizzle schema is unchanged, so `db:generate` still diffs
-- against the unchanged snapshot (0017_snapshot.json is a copy of 0016's — no schema drift).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Customers (platform)
CREATE INDEX IF NOT EXISTS "customers_name_trgm" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_email_trgm" ON "customers" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_company_trgm" ON "customers" USING gin ("company" gin_trgm_ops);--> statement-breakpoint

-- Invoices
CREATE INDEX IF NOT EXISTS "invoices_number_trgm" ON "invoices" USING gin ("number" gin_trgm_ops);--> statement-breakpoint

-- Quotes
CREATE INDEX IF NOT EXISTS "quotes_number_trgm" ON "quotes" USING gin ("number" gin_trgm_ops);--> statement-breakpoint

-- Books
CREATE INDEX IF NOT EXISTS "book_transactions_description_trgm" ON "book_transactions" USING gin ("description" gin_trgm_ops);--> statement-breakpoint

-- Drive earnings
CREATE INDEX IF NOT EXISTS "drive_earnings_description_trgm" ON "drive_earnings" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_earnings_notes_trgm" ON "drive_earnings" USING gin ("notes" gin_trgm_ops);--> statement-breakpoint

-- Drive trips
CREATE INDEX IF NOT EXISTS "drive_trips_purpose_trgm" ON "drive_trips" USING gin ("purpose" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_trips_notes_trgm" ON "drive_trips" USING gin ("notes" gin_trgm_ops);--> statement-breakpoint

-- Drive vehicle expenses (listExpenses gained a `search` param in Wave 3)
CREATE INDEX IF NOT EXISTS "driver_vehicle_expenses_description_trgm" ON "driver_vehicle_expenses" USING gin ("description" gin_trgm_ops);--> statement-breakpoint

-- Files (listFiles gained a `search` param in Wave 3)
CREATE INDEX IF NOT EXISTS "files_file_name_trgm" ON "files" USING gin ("file_name" gin_trgm_ops);