CREATE TYPE "public"."book_type" AS ENUM('income', 'expense');--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "book_transactions" ADD CONSTRAINT "book_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_transactions" ADD CONSTRAINT "book_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_transactions_workspace_date_idx" ON "book_transactions" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "book_transactions_workspace_type_idx" ON "book_transactions" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "book_transactions_workspace_customer_idx" ON "book_transactions" USING btree ("workspace_id","customer_id");