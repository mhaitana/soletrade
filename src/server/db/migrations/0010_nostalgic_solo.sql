CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted');--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_line_items_quote_idx" ON "quote_line_items" USING btree ("quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_workspace_number_unique" ON "quotes" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "quotes_workspace_status_idx" ON "quotes" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "quotes_workspace_customer_idx" ON "quotes" USING btree ("workspace_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_public_token_unique" ON "quotes" USING btree ("public_token") WHERE public_token IS NOT NULL;