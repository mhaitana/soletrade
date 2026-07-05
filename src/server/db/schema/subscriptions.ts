import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SubscriptionId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { planTierEnum, subscriptionStatusEnum } from "./enums";

/**
 * The workspace's unified subscription (brief §4 — one Stripe customer + one
 * unified subscription per workspace; modules are subscription items). One row
 * per workspace (workspaceId is unique). The Stripe customer/subscription ids
 * are populated in Phase 4b when a workspace upgrades to Pro; until then a
 * free-tier row exists with null Stripe ids. `anchorBillingDate` is set on the
 * first Pro upgrade and never updated after — the anchor billing date is
 * preserved across plan/module changes.
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().$type<SubscriptionId>().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .$type<WorkspaceId>()
    .references(() => workspaces.id)
    .unique(),
  tier: planTierEnum("tier").notNull().default("free"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  /** Stripe customer id (cus_…). Populated in Phase 4b on first Pro upgrade. */
  stripeCustomerId: text("stripe_customer_id"),
  /** Stripe subscription id (sub_…). Populated in Phase 4b. */
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Set on the first Pro upgrade; preserved (never updated) thereafter. */
  anchorBillingDate: timestamp("anchor_billing_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
