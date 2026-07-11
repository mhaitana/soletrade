-- Enable Row Level Security (RLS) on all active tables to prevent public/anonymous Data API access.
-- Since the application backend uses the service_role key (which bypasses RLS),
-- enabling RLS secures the database against direct public API requests without affecting backend operations.
-- Note: workspace_settings table is omitted as it was dropped cascade in migration 0018 of the baseline.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_installations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processed_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "book_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drive_earnings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drive_trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "driver_vehicle_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "driver_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_extractions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_periods" ENABLE ROW LEVEL SECURITY;
