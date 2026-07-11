-- Baseline schema for soletrade OS.
--
-- Consolidated from the 23 Drizzle-managed migrations (0000..0022) that
-- previously lived in src/server/db/migrations/. This is the exact DDL Drizzle
-- applied, in order, with Drizzle's `--> statement-breakpoint` markers stripped
-- (they were comments; Postgres ignored them). Future schema changes are plain
-- SQL files added to supabase/migrations/ in timestamp order.
--
-- Includes the pg_trgm extension + 12 GIN trigram indexes (from 0017), all
-- 29 tables, 13 enums, FKs, and indexes. No RLS policies (scoping is in app
-- code via workspaceId). No GRANTs (platform defaults).

-- ==== 0000_silky_frank_castle.sql ====
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked');
CREATE TYPE "public"."module_installation_status" AS ENUM('active', 'cancelled');
CREATE TYPE "public"."module_key" AS ENUM('invoices', 'books', 'drive', 'quotes');
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'manager', 'accountant', 'employee', 'readonly');
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"default_currency" text DEFAULT 'AUD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);

CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'employee' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);

CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'employee' NOT NULL,
	"invited_by_user_id" uuid,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_unique" UNIQUE("token")
);

CREATE TABLE "workspace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"default_currency" text DEFAULT 'AUD' NOT NULL,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"invoice_prefix" text DEFAULT 'INV-' NOT NULL,
	"quote_prefix" text DEFAULT 'QUO-' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_workspace_id_unique" UNIQUE("workspace_id")
);

CREATE TABLE "module_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"module_key" "module_key" NOT NULL,
	"status" "module_installation_status" DEFAULT 'active' NOT NULL,
	"stripe_subscription_item_id" text,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "module_installations" ADD CONSTRAINT "module_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "workspace_members_workspace_user_unique" ON "workspace_members" USING btree ("workspace_id","user_id");
CREATE UNIQUE INDEX "module_installations_workspace_module_unique" ON "module_installations" USING btree ("workspace_id","module_key");
CREATE UNIQUE INDEX "customers_workspace_email_unique" ON "customers" USING btree ("workspace_id","email") WHERE "customers"."email" is not null and "customers"."deleted_at" is null;
CREATE INDEX "customers_workspace_idx" ON "customers" USING btree ("workspace_id");
-- ==== 0001_careless_speedball.sql ====
CREATE TYPE "public"."credit_entry_type" AS ENUM('grant', 'consumption', 'refund', 'adjustment');
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'pro');
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'incomplete');
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tier" "plan_tier" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"anchor_billing_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_workspace_id_unique" UNIQUE("workspace_id")
);

CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entry_type" "credit_entry_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"reason" text NOT NULL,
	"module_key" "module_key",
	"actor_user_id" uuid,
	"stripe_invoice_id" text,
	"stripe_refund_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "credit_ledger_workspace_created_idx" ON "credit_ledger" USING btree ("workspace_id","created_at");
-- ==== 0002_smiling_mastermind.sql ====
CREATE TABLE "processed_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"stripe_event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);

-- ==== 0003_billing_interval.sql ====
-- Reworked billing model (brief §10): drop the Free/Pro `plan_tier` enum/column and
-- replace it with a nullable `billing_interval` (monthly | annual). Null = billing not
-- started. Pre-production: no real data to migrate, so a drop+add is safe.
ALTER TABLE "subscriptions" DROP COLUMN "tier";
DROP TYPE "plan_tier";
CREATE TYPE "billing_interval" AS ENUM('monthly', 'annual');
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" "billing_interval";
-- ==== 0004_deep_impossible_man.sql ====
CREATE UNIQUE INDEX "credit_ledger_stripe_invoice_unique" ON "credit_ledger" USING btree ("workspace_id","stripe_invoice_id") WHERE stripe_invoice_id IS NOT NULL;
-- ==== 0005_light_mister_sinister.sql ====
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'viewed', 'paid', 'void');
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid,
	"number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"tax_rate" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"public_token" text,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id","position");
CREATE UNIQUE INDEX "invoices_workspace_number_unique" ON "invoices" USING btree ("workspace_id","number");
CREATE INDEX "invoices_workspace_status_idx" ON "invoices" USING btree ("workspace_id","status");
CREATE INDEX "invoices_workspace_customer_idx" ON "invoices" USING btree ("workspace_id","customer_id");
CREATE UNIQUE INDEX "invoices_public_token_unique" ON "invoices" USING btree ("public_token") WHERE public_token IS NOT NULL;
-- ==== 0006_busy_the_enforcers.sql ====
ALTER TYPE "public"."invoice_status" ADD VALUE 'overdue';
ALTER TABLE "invoices" ADD COLUMN "stripe_payment_intent_id" text;
ALTER TABLE "invoices" ADD COLUMN "stripe_charge_id" text;
CREATE UNIQUE INDEX "invoices_stripe_pi_unique" ON "invoices" USING btree ("stripe_payment_intent_id") WHERE stripe_payment_intent_id IS NOT NULL;
-- ==== 0007_orange_starjammers.sql ====
CREATE TYPE "public"."book_type" AS ENUM('income', 'expense');
CREATE TABLE "book_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "book_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"date" timestamp NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"customer_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "book_transactions" ADD CONSTRAINT "book_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_transactions" ADD CONSTRAINT "book_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "book_transactions_workspace_date_idx" ON "book_transactions" USING btree ("workspace_id","date");
CREATE INDEX "book_transactions_workspace_type_idx" ON "book_transactions" USING btree ("workspace_id","type");
CREATE INDEX "book_transactions_workspace_customer_idx" ON "book_transactions" USING btree ("workspace_id","customer_id");
-- ==== 0008_windy_talkback.sql ====
ALTER TABLE "book_transactions" ADD COLUMN "source_invoice_id" uuid;
CREATE INDEX "book_transactions_workspace_source_invoice_idx" ON "book_transactions" USING btree ("workspace_id","source_invoice_id");
-- ==== 0009_lovely_the_hood.sql ====
CREATE TABLE "drive_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"date" timestamp NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "drive_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"distance_meters" integer NOT NULL,
	"date" timestamp NOT NULL,
	"purpose" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "book_transactions" ADD COLUMN "source_earning_id" uuid;
ALTER TABLE "drive_earnings" ADD CONSTRAINT "drive_earnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "drive_trips" ADD CONSTRAINT "drive_trips_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "drive_earnings_workspace_date_idx" ON "drive_earnings" USING btree ("workspace_id","date");
CREATE INDEX "drive_earnings_workspace_platform_idx" ON "drive_earnings" USING btree ("workspace_id","platform");
CREATE INDEX "drive_trips_workspace_date_idx" ON "drive_trips" USING btree ("workspace_id","date");
CREATE INDEX "drive_trips_workspace_platform_idx" ON "drive_trips" USING btree ("workspace_id","platform");
CREATE INDEX "book_transactions_workspace_source_earning_idx" ON "book_transactions" USING btree ("workspace_id","source_earning_id");
-- ==== 0010_nostalgic_solo.sql ====
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted');
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid,
	"number" text NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"tax_rate" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"public_token" text,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"converted_at" timestamp,
	"converted_invoice_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "quote_line_items_quote_idx" ON "quote_line_items" USING btree ("quote_id","position");
CREATE UNIQUE INDEX "quotes_workspace_number_unique" ON "quotes" USING btree ("workspace_id","number");
CREATE INDEX "quotes_workspace_status_idx" ON "quotes" USING btree ("workspace_id","status");
CREATE INDEX "quotes_workspace_customer_idx" ON "quotes" USING btree ("workspace_id","customer_id");
CREATE UNIQUE INDEX "quotes_public_token_unique" ON "quotes" USING btree ("public_token") WHERE public_token IS NOT NULL;
-- ==== 0011_cold_scorpion.sql ====
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant');
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "ai_conversations_workspace_user_created_idx" ON "ai_conversations" USING btree ("workspace_id","user_id","created_at");
CREATE INDEX "ai_messages_conversation_created_idx" ON "ai_messages" USING btree ("conversation_id","created_at");
-- ==== 0012_damp_randall_flagg.sql ====
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "book_transactions" ADD COLUMN "receipt_file_id" uuid;
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "files_workspace_created_idx" ON "files" USING btree ("workspace_id","created_at");
CREATE INDEX "files_workspace_entity_idx" ON "files" USING btree ("workspace_id","entity_type","entity_id");
-- ==== 0013_concerned_veda.sql ====
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "notifications_workspace_user_created_idx" ON "notifications" USING btree ("workspace_id","user_id","created_at");
CREATE INDEX "notifications_workspace_user_read_idx" ON "notifications" USING btree ("workspace_id","user_id","read_at");
-- ==== 0014_reflective_proudstar.sql ====
ALTER TABLE "ai_conversations" ADD COLUMN "write_enabled" boolean DEFAULT false NOT NULL;
-- ==== 0015_smiling_rick_jones.sql ====
ALTER TYPE "public"."credit_entry_type" ADD VALUE 'promotion';
ALTER TYPE "public"."credit_entry_type" ADD VALUE 'expired';
ALTER TABLE "module_installations" ADD COLUMN "pending_cancellation_at" timestamp;
ALTER TABLE "credit_ledger" ADD COLUMN "expires_at" timestamp;
CREATE UNIQUE INDEX "credit_ledger_expired_original_unique" ON "credit_ledger" USING btree ("workspace_id",(metadata->>'originalEntryId')) WHERE entry_type = 'expired';
-- ==== 0016_colossal_killmonger.sql ====
CREATE TYPE "public"."receipt_extraction_status" AS ENUM('pending', 'reviewed', 'applied', 'rejected');
CREATE TYPE "public"."vehicle_expense_type" AS ENUM('fuel', 'maintenance', 'insurance', 'registration', 'other');
CREATE TABLE "quote_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"accepter_name" text NOT NULL,
	"accepter_email" text,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"signature" text,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "quote_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"odometer_km" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "driver_vehicle_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"type" "vehicle_expense_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"date" timestamp NOT NULL,
	"odometer_km" integer,
	"description" text NOT NULL,
	"notes" text,
	"receipt_file_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mileage_rate_cents_per_km" integer DEFAULT 85 NOT NULL,
	"default_vehicle_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "receipt_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"status" "receipt_extraction_status" DEFAULT 'pending' NOT NULL,
	"extracted_data" jsonb,
	"transaction_id" uuid,
	"error_message" text,
	"model_used" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "tax_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"period_label" text NOT NULL,
	"gst_collected_cents" integer DEFAULT 0 NOT NULL,
	"gst_paid_cents" integer DEFAULT 0 NOT NULL,
	"net_gst_cents" integer DEFAULT 0 NOT NULL,
	"lodged_at" timestamp,
	"lodged_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DROP INDEX "credit_ledger_expired_original_unique";
ALTER TABLE "quotes" ADD COLUMN "terms_conditions" text;
ALTER TABLE "book_transactions" ADD COLUMN "gst_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "book_transactions" ADD COLUMN "source_expense_id" uuid;
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "driver_vehicle_expenses" ADD CONSTRAINT "driver_vehicle_expenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "driver_vehicle_expenses" ADD CONSTRAINT "driver_vehicle_expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_default_vehicle_id_vehicles_id_fk" FOREIGN KEY ("default_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "receipt_extractions" ADD CONSTRAINT "receipt_extractions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "receipt_extractions" ADD CONSTRAINT "receipt_extractions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_lodged_by_user_id_users_id_fk" FOREIGN KEY ("lodged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "quote_acceptances_quote_idx" ON "quote_acceptances" USING btree ("quote_id");
CREATE INDEX "quote_sections_quote_idx" ON "quote_sections" USING btree ("quote_id","position");
CREATE INDEX "vehicles_workspace_active_idx" ON "vehicles" USING btree ("workspace_id","active");
CREATE INDEX "driver_vehicle_expenses_workspace_date_idx" ON "driver_vehicle_expenses" USING btree ("workspace_id","date");
CREATE INDEX "driver_vehicle_expenses_workspace_vehicle_idx" ON "driver_vehicle_expenses" USING btree ("workspace_id","vehicle_id");
CREATE UNIQUE INDEX "driver_profiles_workspace_unique" ON "driver_profiles" USING btree ("workspace_id");
CREATE INDEX "receipt_extractions_workspace_status_idx" ON "receipt_extractions" USING btree ("workspace_id","status");
CREATE INDEX "receipt_extractions_workspace_file_idx" ON "receipt_extractions" USING btree ("workspace_id","file_id");
CREATE UNIQUE INDEX "tax_periods_workspace_period_unique" ON "tax_periods" USING btree ("workspace_id","period_label");
CREATE INDEX "book_transactions_workspace_source_expense_idx" ON "book_transactions" USING btree ("workspace_id","source_expense_id");
CREATE INDEX "book_transactions_workspace_receipt_file_idx" ON "book_transactions" USING btree ("workspace_id","receipt_file_id");
CREATE UNIQUE INDEX "credit_ledger_expired_original_unique" ON "credit_ledger" USING btree ("workspace_id",(metadata->>'originalEntryId')) WHERE entry_type = 'expired';
-- ==== 0017_search_trigram_indexes.sql ====
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
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Customers (platform)
CREATE INDEX IF NOT EXISTS "customers_name_trgm" ON "customers" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_email_trgm" ON "customers" USING gin ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_company_trgm" ON "customers" USING gin ("company" gin_trgm_ops);

-- Invoices
CREATE INDEX IF NOT EXISTS "invoices_number_trgm" ON "invoices" USING gin ("number" gin_trgm_ops);

-- Quotes
CREATE INDEX IF NOT EXISTS "quotes_number_trgm" ON "quotes" USING gin ("number" gin_trgm_ops);

-- Books
CREATE INDEX IF NOT EXISTS "book_transactions_description_trgm" ON "book_transactions" USING gin ("description" gin_trgm_ops);

-- Drive earnings
CREATE INDEX IF NOT EXISTS "drive_earnings_description_trgm" ON "drive_earnings" USING gin ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "drive_earnings_notes_trgm" ON "drive_earnings" USING gin ("notes" gin_trgm_ops);

-- Drive trips
CREATE INDEX IF NOT EXISTS "drive_trips_purpose_trgm" ON "drive_trips" USING gin ("purpose" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "drive_trips_notes_trgm" ON "drive_trips" USING gin ("notes" gin_trgm_ops);

-- Drive vehicle expenses (listExpenses gained a `search` param in Wave 3)
CREATE INDEX IF NOT EXISTS "driver_vehicle_expenses_description_trgm" ON "driver_vehicle_expenses" USING gin ("description" gin_trgm_ops);

-- Files (listFiles gained a `search` param in Wave 3)
CREATE INDEX IF NOT EXISTS "files_file_name_trgm" ON "files" USING gin ("file_name" gin_trgm_ops);
-- ==== 0018_violet_vision.sql ====
DROP TABLE "workspace_settings" CASCADE;
ALTER TABLE "workspaces" ADD COLUMN "timezone" text DEFAULT 'Australia/Sydney' NOT NULL;
ALTER TABLE "workspaces" ADD COLUMN "invoice_prefix" text DEFAULT 'INV-' NOT NULL;
ALTER TABLE "workspaces" ADD COLUMN "quote_prefix" text DEFAULT 'QUO-' NOT NULL;
-- ==== 0019_feed_audit_indexes.sql ====
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
  ON "activity_events" ("workspace_id", "created_at" DESC, "id" DESC);

-- Activity feed: entity-filtered path (customer timeline filters `entity_type='customer'`
-- + `entity_id`). Lets the timeline skip the workspace-wide sort.
CREATE INDEX IF NOT EXISTS "activity_events_workspace_entity_idx"
  ON "activity_events" ("workspace_id", "entity_type", "entity_id", "created_at" DESC);

-- Audit log: `/audit` filters `workspace_id` + keyset-paginates on `(created_at DESC, id DESC)`.
CREATE INDEX IF NOT EXISTS "audit_logs_workspace_created_idx"
  ON "audit_logs" ("workspace_id", "created_at" DESC, "id" DESC);

-- Drive vehicle expenses: trigram index for `listExpenses` ILIKE on `notes`
-- (the one search column missing backing in migration 0017).
CREATE INDEX IF NOT EXISTS "driver_vehicle_expenses_notes_trgm"
  ON "driver_vehicle_expenses" USING gin ("notes" gin_trgm_ops);

-- Customers: list orders by `created_at DESC` and filters out soft-deleted rows.
-- A partial index covering the live rows avoids sorting the filtered set.
CREATE INDEX IF NOT EXISTS "customers_workspace_created_live_idx"
  ON "customers" ("workspace_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;
-- ==== 0020_smiling_toad.sql ====
ALTER TABLE "invoices" ADD COLUMN "prices_include_tax" boolean DEFAULT false NOT NULL;
ALTER TABLE "quotes" ADD COLUMN "prices_include_tax" boolean DEFAULT false NOT NULL;
-- ==== 0021_lazy_maestro.sql ====
ALTER TABLE "book_transactions" ADD COLUMN "source_trip_id" uuid;
CREATE INDEX "book_transactions_workspace_source_trip_idx" ON "book_transactions" USING btree ("workspace_id","source_trip_id");
-- ==== 0022_useful_network.sql ====
ALTER TABLE "workspaces" ADD COLUMN "fy_start_month" integer DEFAULT 7 NOT NULL;
