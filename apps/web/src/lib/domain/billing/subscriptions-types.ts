import type { BillingInterval } from "@/lib/domain/database-enums";
import type { SubscriptionId, WorkspaceId } from "@/types/ids";

export interface SubscriptionRow {
  id: SubscriptionId;
  workspaceId: WorkspaceId;
  billingInterval: BillingInterval | null;
  status: "active" | "past_due" | "canceled" | "incomplete";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  anchorBillingDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
