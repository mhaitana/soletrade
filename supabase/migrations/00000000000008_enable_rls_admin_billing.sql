-- Enable Row Level Security on the tables introduced by migrations 0006 (admin area)
-- and 0007 (admin Stripe sync). Migration 0004 enabled RLS on the original baseline
-- tables but these 24 new tables slipped through without it, leaving them fully exposed
-- to the anon/authenticated roles via the Data API.
--
-- As with 0004/0005, the application reads/writes ALL business data through the
-- service_role key, which bypasses RLS — so enabling RLS here does not affect any app
-- code path. These tables are intentionally given NO policies: admin, billing,
-- support, platform, and background-job tables must never be reachable by anon/
-- authenticated clients, so deny-all is the correct default. (If a future feature ever
-- needs anon access to one of these, add a SELECT policy in a new migration — don't
-- widen this one.)
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if RLS is already on.

-- Admin / internal staff
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_internal_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_announcements" ENABLE ROW LEVEL SECURITY;

-- Billing / promotions
ALTER TABLE "billing_credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_adjustment_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotion_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotion_redemptions" ENABLE ROW LEVEL SECURITY;

-- Support
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_ticket_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_ticket_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_events" ENABLE ROW LEVEL SECURITY;

-- Platform / feature flags
ALTER TABLE "platform_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flag_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flag_audit_events" ENABLE ROW LEVEL SECURITY;

-- Infra
ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;