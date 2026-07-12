-- Soletrade Workspace Admin → Stripe sync
-- Adds the columns needed for the admin portal to (a) create Stripe coupons/promotion
-- codes and (b) reconcile live Stripe subscription state back into the local
-- `subscriptions` cache, so admins never need to open the Stripe dashboard.
--
-- Also fixes a latent bug: `listWorkspaceSubscriptions` already selected
-- `current_period_end`, `cancel_at_period_end`, `anchor_module_key`, and
-- `addon_module_keys`, but those columns did not exist → PostgREST 400 against a real
-- DB. Adding them here makes that query valid AND stores the synced Stripe state.

-- Subscriptions: cache of Stripe subscription fields surfaced/synced by the admin
-- Reconcile action (and kept fresh by webhooks going forward).
ALTER TABLE "subscriptions"
  ADD COLUMN "current_period_end" timestamptz,
  ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  ADD COLUMN "anchor_module_key" text,
  ADD COLUMN "addon_module_keys" text[] DEFAULT '{}' NOT NULL;

-- Promotions: redemption state mirrored from Stripe by the admin Sync action.
ALTER TABLE "promotions"
  ADD COLUMN "times_redeemed" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "stripe_coupon_active" boolean DEFAULT true,
  ADD COLUMN "stripe_promotion_code_active" boolean,
  ADD COLUMN "last_synced_at" timestamptz;