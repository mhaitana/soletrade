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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("module_installations_workspace_module_unique").on(t.workspaceId, t.moduleKey),
  ],
);
