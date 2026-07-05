ALTER TYPE "public"."invoice_status" ADD VALUE 'overdue';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_stripe_pi_unique" ON "invoices" USING btree ("stripe_payment_intent_id") WHERE stripe_payment_intent_id IS NOT NULL;