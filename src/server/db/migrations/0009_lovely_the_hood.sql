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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "book_transactions" ADD COLUMN "source_earning_id" uuid;--> statement-breakpoint
ALTER TABLE "drive_earnings" ADD CONSTRAINT "drive_earnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_trips" ADD CONSTRAINT "drive_trips_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_earnings_workspace_date_idx" ON "drive_earnings" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "drive_earnings_workspace_platform_idx" ON "drive_earnings" USING btree ("workspace_id","platform");--> statement-breakpoint
CREATE INDEX "drive_trips_workspace_date_idx" ON "drive_trips" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "drive_trips_workspace_platform_idx" ON "drive_trips" USING btree ("workspace_id","platform");--> statement-breakpoint
CREATE INDEX "book_transactions_workspace_source_earning_idx" ON "book_transactions" USING btree ("workspace_id","source_earning_id");