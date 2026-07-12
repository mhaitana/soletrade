-- Soletrade Workspace Admin Area Migration
-- Creates dedicated schema objects for internal staff operations, auditable RBAC,
-- customer-approved temporary support access sessions, and platform administration.

-- 1. Enums
CREATE TYPE "public"."admin_role" AS ENUM(
  'super_admin',
  'operations_admin',
  'billing_admin',
  'support_manager',
  'support_agent',
  'security_auditor',
  'read_only_admin'
);

CREATE TYPE "public"."support_access_scope" AS ENUM(
  'workspace_settings',
  'customers',
  'invoices',
  'quotes',
  'books',
  'drive',
  'files',
  'activity',
  'integrations',
  'technical_logs'
);

CREATE TYPE "public"."support_access_level" AS ENUM(
  'metadata_only',
  'read_only',
  'guided_write'
);

CREATE TYPE "public"."support_ticket_status" AS ENUM(
  'open',
  'waiting_for_support',
  'waiting_for_customer',
  'resolved',
  'closed'
);

CREATE TYPE "public"."support_ticket_priority" AS ENUM(
  'low',
  'normal',
  'high',
  'urgent'
);

CREATE TYPE "public"."promotion_discount_type" AS ENUM(
  'percentage',
  'fixed_amount'
);

CREATE TYPE "public"."promotion_duration" AS ENUM(
  'once',
  'repeating',
  'forever'
);

CREATE TYPE "public"."billing_credit_entry_type" AS ENUM(
  'support_adjustment',
  'service_interruption',
  'billing_correction',
  'retention_credit',
  'promotional_credit',
  'refund_conversion',
  'manual_adjustment',
  'credit_applied',
  'credit_reversed',
  'credit_expired'
);

-- 2. Internal Admin Staff & RBAC
CREATE TABLE "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "full_name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "mfa_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "admin_role_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "role" "admin_role" NOT NULL,
  "assigned_by" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "admin_role_assignments_unique" UNIQUE("admin_user_id", "role")
);

CREATE TABLE "admin_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "session_token" text NOT NULL UNIQUE,
  "ip_address" text,
  "user_agent" text,
  "last_active_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "admin_security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid REFERENCES "admin_users"("id"),
  "event_type" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "admin_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "actor_role" "admin_role" NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "workspace_id" uuid,
  "user_id" uuid,
  "ticket_id" text,
  "reason" text,
  "before_state" jsonb,
  "after_state" jsonb,
  "metadata" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "admin_internal_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "author_admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 3. Support Tickets & Messages
CREATE TABLE "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "requester_user_id" uuid NOT NULL,
  "assigned_admin_id" uuid REFERENCES "admin_users"("id"),
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "priority" "support_ticket_priority" DEFAULT 'normal' NOT NULL,
  "status" "support_ticket_status" DEFAULT 'open' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);

CREATE TABLE "support_ticket_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "author_id" text NOT NULL,
  "author_type" text NOT NULL,
  "content" text NOT NULL,
  "is_internal" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "support_ticket_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "assigned_admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "assigned_by" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 4. Customer-Approved Temporary Support Access
CREATE TABLE "support_access_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "ticket_id" uuid REFERENCES "support_tickets"("id"),
  "requested_by_admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "scopes" text[] NOT NULL,
  "access_level" "support_access_level" DEFAULT 'read_only' NOT NULL,
  "reason" text NOT NULL,
  "requested_duration_minutes" integer DEFAULT 60 NOT NULL,
  "customer_explanation" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "support_access_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "support_access_requests"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "ticket_id" uuid REFERENCES "support_tickets"("id"),
  "approved_by_user_id" uuid NOT NULL,
  "admin_user_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "scopes" text[] NOT NULL,
  "access_level" "support_access_level" DEFAULT 'read_only' NOT NULL,
  "reason" text NOT NULL,
  "starts_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "revoked_by_user_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "support_access_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "support_access_sessions"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "target_entity" text,
  "target_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 5. Promotions & Redemptions
CREATE TABLE "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "internal_description" text,
  "public_code" text UNIQUE,
  "stripe_coupon_id" text NOT NULL,
  "stripe_promotion_code_id" text,
  "discount_type" "promotion_discount_type" NOT NULL,
  "percent_off" numeric,
  "amount_off_cents" integer,
  "currency" text DEFAULT 'AUD',
  "duration" "promotion_duration" NOT NULL,
  "duration_in_months" integer,
  "max_redemptions" integer,
  "redeem_by" timestamp,
  "applies_to_modules" text[],
  "applies_to_intervals" text[],
  "new_customers_only" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "promotion_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "promotion_id" uuid NOT NULL REFERENCES "promotions"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "assigned_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "promotion_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "promotion_id" uuid NOT NULL REFERENCES "promotions"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "stripe_subscription_id" text,
  "redeemed_at" timestamp DEFAULT now() NOT NULL
);

-- 6. Billing Credit Ledger
CREATE TABLE "billing_credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'AUD' NOT NULL,
  "type" "billing_credit_entry_type" NOT NULL,
  "reason" text NOT NULL,
  "internal_note" text,
  "related_ticket_id" uuid REFERENCES "support_tickets"("id"),
  "related_invoice_id" text,
  "stripe_reference" text,
  "created_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp,
  "reversed_entry_id" uuid REFERENCES "billing_credit_ledger"("id")
);

CREATE TABLE "billing_adjustment_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ledger_entry_id" uuid REFERENCES "billing_credit_ledger"("id"),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "requested_amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'AUD' NOT NULL,
  "requested_by_admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "approved_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "status" text DEFAULT 'pending' NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);

-- 7. Platform Operations & Feature Flags
CREATE TABLE "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "rollout_percentage" integer DEFAULT 0 NOT NULL,
  "workspace_allowlist" text[],
  "workspace_blocklist" text[],
  "user_allowlist" text[],
  "created_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "feature_flag_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feature_flag_id" uuid NOT NULL REFERENCES "feature_flags"("id") ON DELETE CASCADE,
  "rule_type" text NOT NULL,
  "rule_value" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "feature_flag_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feature_flag_id" uuid NOT NULL REFERENCES "feature_flags"("id") ON DELETE CASCADE,
  "actor_admin_id" uuid NOT NULL REFERENCES "admin_users"("id"),
  "action" text NOT NULL,
  "changes" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "event_id" text NOT NULL UNIQUE,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'processed' NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "queue" text DEFAULT 'default' NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  "run_time_ms" integer,
  "error" text,
  "workspace_id" uuid,
  "related_entity" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE TABLE "platform_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'investigating' NOT NULL,
  "created_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);

CREATE TABLE "admin_announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "target_workspaces" text[],
  "created_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for performance and auditing
CREATE INDEX "idx_admin_audit_events_actor" ON "admin_audit_events"("actor_admin_id");
CREATE INDEX "idx_admin_audit_events_target" ON "admin_audit_events"("target_type", "target_id");
CREATE INDEX "idx_admin_audit_events_workspace" ON "admin_audit_events"("workspace_id");
CREATE INDEX "idx_support_access_sessions_workspace" ON "support_access_sessions"("workspace_id", "status");
CREATE INDEX "idx_billing_credit_ledger_workspace" ON "billing_credit_ledger"("workspace_id");

-- Bootstrap initial Super Admin account (admin@soletrade.example, password: password123)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- 1. Check if admin@soletrade.example already exists in auth.users
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE email = 'admin@soletrade.example'
  LIMIT 1;

  -- 2. If not found, create in auth.users with password 'password123'
  IF v_admin_id IS NULL THEN
    v_admin_id := '11111111-1111-4111-8111-111111110099'::uuid;

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      is_super_admin, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at
    )
    VALUES (
      v_admin_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'admin@soletrade.example',
      extensions.crypt('password123', extensions.gen_salt('bf')), now(),
      '', '', '', '', false,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Soletrade Super Admin"}'::jsonb, now(), now(), now()
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3. Ensure entry in public.users
  INSERT INTO public.users (id, email, full_name, created_at, updated_at)
  VALUES (
    v_admin_id, 'admin@soletrade.example', 'Soletrade Super Admin', now(), now()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, full_name = EXCLUDED.full_name;

  -- 4. Ensure entry in public.admin_users
  INSERT INTO public.admin_users (id, email, full_name, is_active)
  VALUES (
    v_admin_id,
    'admin@soletrade.example',
    'Soletrade Super Admin',
    true
  )
  ON CONFLICT (email) DO UPDATE
  SET is_active = true, id = EXCLUDED.id;

  -- 5. Assign super_admin role
  INSERT INTO public.admin_role_assignments (admin_user_id, role)
  VALUES (v_admin_id, 'super_admin')
  ON CONFLICT (admin_user_id, role) DO NOTHING;
END $$;
