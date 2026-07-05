import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SubscriptionId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { billingIntervalEnum, subscriptionStatusEnum } from "./enums";

/**
 * The workspace's unified subscription (brief §10 — one Stripe customer + one
 * unified subscription per workspace; modules are subscription items). One row
 * per workspace (workspaceId is unique). The row exists from workspace creation
 * onward with `billingInterval = null` (billing not started) and null Stripe ids.
 * `billingInterval` + `stripeCustomerId`/`stripeSubscriptionId` are populated when
 * the workspace starts billing via Stripe Checkout; `anchorBillingDate` is set on
 * the first start-billing and never updated after — the anchor billing date is
 * preserved across module/anchor changes.
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().$type<SubscriptionId>().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .$type<WorkspaceId>()
    .references(() => workspaces.id)
    .unique(),
  /** Monthly or annual billing. Null until the workspace starts billing. */
  billingInterval: billingIntervalEnum("billing_interval"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  /** Stripe customer id (cus_…). Populated when billing starts. */
  stripeCustomerId: text("stripe_customer_id"),
  /** Stripe subscription id (sub_…). Populated when billing starts. */
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Set on the first start-billing; preserved (never updated) thereafter. */
  anchorBillingDate: timestamp("anchor_billing_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
