DROP TABLE "workspace_settings" CASCADE;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "timezone" text DEFAULT 'Australia/Sydney' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "invoice_prefix" text DEFAULT 'INV-' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "quote_prefix" text DEFAULT 'QUO-' NOT NULL;