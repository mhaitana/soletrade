import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ModuleInstallationId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { moduleInstallationStatusEnum, moduleKeyEnum } from "./enums";

/**
 * Per-workspace module enable/disable record. A module is "installed" when an
 * active row exists. The Stripe subscription item id is wired in Phase 3.
 */
export const moduleInstallations = pgTable(
  "module_installations",
  {
    id: uuid("id").primaryKey().$type<ModuleInstallationId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    moduleKey: moduleKeyEnum("module_key").notNull(),
    status: moduleInstallationStatusEnum("status").notNull().default("active"),
    /** Stripe subscription item id — populated in Phase 3 (billing). */
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    installedAt: timestamp("installed_at").defaultNow().notNull(),
    cancelledAt: timestamp("cancelled_at"),
    /**
     * Scheduled end-of-cycle cancellation timestamp (Wave 1 cancellation engine, brief
     * §10.6 Branch A "keep-until-end"). When set, the module stays active and billable
     * until this time; the `module-cancel-finalize` cron then deletes the Stripe item +
     * disables the row. Null for immediate cancellations and active modules.
     */
    pendingCancellationAt: timestamp("pending_cancellation_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("module_installations_workspace_module_unique").on(t.workspaceId, t.moduleKey),
  ],
);
