CREATE TYPE "public"."receipt_extraction_status" AS ENUM('pending', 'reviewed', 'applied', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vehicle_expense_type" AS ENUM('fuel', 'maintenance', 'insurance', 'registration', 'other');--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mileage_rate_cents_per_km" integer DEFAULT 85 NOT NULL,
	"default_vehicle_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
DROP INDEX "credit_ledger_expired_original_unique";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "terms_conditions" text;--> statement-breakpoint
ALTER TABLE "book_transactions" ADD COLUMN "gst_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_transactions" ADD COLUMN "source_expense_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_expenses" ADD CONSTRAINT "driver_vehicle_expenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_expenses" ADD CONSTRAINT "driver_vehicle_expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_default_vehicle_id_vehicles_id_fk" FOREIGN KEY ("default_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_extractions" ADD CONSTRAINT "receipt_extractions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_extractions" ADD CONSTRAINT "receipt_extractions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_lodged_by_user_id_users_id_fk" FOREIGN KEY ("lodged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_acceptances_quote_idx" ON "quote_acceptances" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_sections_quote_idx" ON "quote_sections" USING btree ("quote_id","position");--> statement-breakpoint
CREATE INDEX "vehicles_workspace_active_idx" ON "vehicles" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE INDEX "driver_vehicle_expenses_workspace_date_idx" ON "driver_vehicle_expenses" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "driver_vehicle_expenses_workspace_vehicle_idx" ON "driver_vehicle_expenses" USING btree ("workspace_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_profiles_workspace_unique" ON "driver_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "receipt_extractions_workspace_status_idx" ON "receipt_extractions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "receipt_extractions_workspace_file_idx" ON "receipt_extractions" USING btree ("workspace_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_periods_workspace_period_unique" ON "tax_periods" USING btree ("workspace_id","period_label");--> statement-breakpoint
CREATE INDEX "book_transactions_workspace_source_expense_idx" ON "book_transactions" USING btree ("workspace_id","source_expense_id");--> statement-breakpoint
CREATE INDEX "book_transactions_workspace_receipt_file_idx" ON "book_transactions" USING btree ("workspace_id","receipt_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_expired_original_unique" ON "credit_ledger" USING btree ("workspace_id",(metadata->>'originalEntryId')) WHERE entry_type = 'expired';