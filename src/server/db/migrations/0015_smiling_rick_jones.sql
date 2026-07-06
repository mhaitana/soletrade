ALTER TYPE "public"."credit_entry_type" ADD VALUE 'promotion';--> statement-breakpoint
ALTER TYPE "public"."credit_entry_type" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "module_installations" ADD COLUMN "pending_cancellation_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_expired_original_unique" ON "credit_ledger" USING btree ("workspace_id",(metadata->>'originalEntryId')) WHERE entry_type = 'expired';